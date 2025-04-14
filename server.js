const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  })
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


app.put('/api/profile', verifyUser, async (req, res) => {
    try {
      const profileData = req.body;
      const userRef = db.collection('users').doc(req.user.uid);
      
      // Add validation for profile data
      if (!profileData || typeof profileData !== 'object') {
        return res.status(400).json({ error: 'Invalid profile data' });
      }
  
      // Remove sensitive fields if present
      delete profileData.roles;
      delete profileData.permissions;
  
      await userRef.set(profileData, { merge: true });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Profile update failed' });
    }
  });
  
  app.get('/api/profile', verifyUser, async (req, res) => {
    try {
      const userRef = db.collection('users').doc(req.user.uid);
      const docSnap = await userRef.get();
      
      if (!docSnap.exists) {
        return res.status(404).json({ error: 'Profile not found' });
      }
  
      const profileData = docSnap.data();
      
      // Sanitize sensitive data before sending to frontend
      const safeData = {
        name: profileData.name,
        email: profileData.email,
        preferences: profileData.preferences
        // Only expose necessary fields
      };
  
      res.json(safeData);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  });
  

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));