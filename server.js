const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

// Initialize Firebase Admin SDK (Secure Server-Side Access)
initializeApp({
  credential: applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID
});

const db = getFirestore();

// Initialize Supabase (Server-Side Only)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // Use service role key here
);

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL })); // Restrict CORS
app.use(express.json({ limit: '10kb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// Helper Middleware to verify Firebase ID token
const verifyUser = async (req, res, next) => {
  const idToken = req.headers.authorization?.split('Bearer ')[1];
  
  if (!idToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const auth = getAuth();
    const decodedToken = await auth.verifyIdToken(idToken);
    req.user = { uid: decodedToken.uid };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Secure Endpoints
app.post('/api/matches', verifyUser, async (req, res) => {
  try {
    const { resumeText, jobDescription, matchResult } = req.body;
    const matchesRef = db.collection('users').doc(req.user.uid).collection('matches');
    
    const docRef = await matchesRef.add({
      resumeText,
      jobDescription,
      matchResult,
      createdAt: FieldValue.serverTimestamp()
    });

    res.json({ id: docRef.id, success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save match' });
  }
});

app.get('/api/matches', verifyUser, async (req, res) => {
  try {
    const matchesRef = db.collection('users').doc(req.user.uid).collection('matches');
    const snapshot = await matchesRef.get();
    
    const matches = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    res.json(matches);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch matches' });
  }
});

app.delete('/api/matches/:matchId', verifyUser, async (req, res) => {
  try {
    const matchRef = db.collection('users').doc(req.user.uid)
                      .collection('matches').doc(req.params.matchId);
    await matchRef.delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete match' });
  }
});

// Secure File Upload Endpoint
app.post('/api/upload-resume', verifyUser, async (req, res) => {
  try {
    const { file } = req.body;
    const fileName = `${req.user.uid}/${Date.now()}_${file.name}`;

    // Upload to Supabase
    const { data, error } = await supabase.storage
      .from('resumes')
      .upload(fileName, file);

    if (error) throw error;

    // Generate signed URL (time-limited access)
    const { data: signedUrl } = await supabase.storage
      .from('resumes')
      .createSignedUrl(data.path, 3600); // 1 hour expiration

    res.json({ url: signedUrl.signedUrl });
  } catch (err) {
    res.status(500).json({ error: 'File upload failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));