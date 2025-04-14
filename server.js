const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const multer = require('multer');
const axios = require('axios');
const app = express();
const { getAuth } = require('firebase-admin/auth');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const upload = multer({ storage: multer.memoryStorage() });
const admin = require('firebase-admin');
const FormData = require('form-data');
const FieldValue = admin.firestore.FieldValue; // <-- Add this

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
// Secure File Upload Endpoint

// Middleware
const allowedOrigins = [process.env.FRONTEND_URL, 'http://localhost:3000'];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));// app.use(express.json({ limit: '10kb' }));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);
console.log('Starting server with environment:', {
    node_env: process.env.NODE_ENV,
    port: process.env.PORT,
    firebase_project: process.env.FIREBASE_PROJECT_ID ? 'set' : 'missing',
    supabase_url: process.env.SUPABASE_URL ? 'set' : 'missing',
    cors_origin: process.env.FRONTEND_URL || 'none'
  });
  
  // Modify verifyUser middleware
  const verifyUser = async (req, res, next) => {
    console.log('Incoming request:', {
      method: req.method,
      path: req.path,
      headers: req.headers
    });
  
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    
    if (!idToken) {
      console.log('Authorization failed: No token provided');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  
    try {
      const auth = getAuth();
      const decodedToken = await auth.verifyIdToken(idToken);
      console.log('Decoded token:', {
        uid: decodedToken.uid,
        iss: decodedToken.iss,
        exp: new Date(decodedToken.exp * 1000)
      });
      req.user = { uid: decodedToken.uid };
      next();
    } catch (err) {
      console.error('Token verification failed:', err.message);
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
    console.log(docRef.id);
    res.json({ id: docRef.id, success: true });
  } catch (err) {
    console.log(err);
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



app.post('/api/upload-resume', verifyUser, upload.single('file'), async (req, res) => {
    try {
      const file = req.file;
      const userId = req.user.uid;
  
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
  
      const fileName = `${userId}/${Date.now()}_${file.originalname}`;
   
      
      const { data, error } = await supabase.storage
        .from('resumes')
        .upload(fileName, file.buffer, {
            contentType: file.mimetype,
          });
  
      if (error) throw error;
      const { data: urlData } = supabase.storage
        .from('resumes')
        .getPublicUrl(fileName);

      res.json({ url: urlData.publicUrl });
    } catch (err) {
      console.error('Upload error:', err.message);
      res.status(500).json({ error: 'Resume upload failed' });
    }
  });

  app.get('/api/resume/:filePath', verifyUser, async (req, res) => {
    const filePath = decodeURIComponent(req.params.filePath); // In case path has `/` or special chars

    try {
      const { data, error } = await supabase.storage
        .from('resumes')
        .download(filePath);

      if (error || !data) {
        console.error("❌ Supabase download error:", error);
        return res.status(404).json({ error: 'Resume not found' });
      }
  
      // Convert Blob to Buffer
    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Set headers and send
    res.setHeader('Content-Disposition', `attachment; filename="${filePath.split('/').pop()}"`);
    res.setHeader('Content-Type', 'application/pdf'); // Adjust if you store other file types
    res.send(buffer);
    } catch (err) {
      console.error("🔥 Server error:", err);
      res.status(500).json({ error: 'Failed to download resume' });
    }
  });
  

app.delete('/api/resume', verifyUser, async (req, res) => {
    try {
      const { resumeUrl } = req.body;
  
      if (!resumeUrl) {
        return res.status(400).json({ error: 'Missing resume URL' });
      }
  
      // Extract the filename from the URL
      const fileName = resumeUrl.split('/').pop();
      const filePath = `${req.user.uid}/${fileName}`;
  
      // Delete the resume file from Supabase storage
      const { error: storageError } = await supabase.storage
        .from('resumes')
        .remove([filePath]);
  
      if (storageError) {
        throw storageError;
      }
  
      // Remove resume reference in Firestore
      const userRef = db.collection('users').doc(req.user.uid);
      await userRef.set(
        {
          resumeUrl: null,
          lastUpdated: new Date(),
        },
        { merge: true }
      );
  
      res.json({ success: true });
    } catch (err) {
      console.error('Resume delete error:', err.message);
      res.status(500).json({ error: 'Failed to delete resume' });
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
  
      await userRef.set(
        {
          ...profileData,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
        res.json({ success: true });
    } catch (err) {
        console.error('Error in /api/profile:', err); // 👈 log the actual error

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
      
  
      res.json(profileData);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  });




  app.post('/api/matchjobs', verifyUser, upload.single('resume'), async (req, res) => {
    try {
      const formData = new FormData();
      formData.append("resume", req.file.buffer, req.file.originalname);
      formData.append("query", req.body.query);
      formData.append("location", req.body.location);
      formData.append("role_type_filter", req.body.role_type_filter);
      formData.append("limit", req.body.limit);
      formData.append("apply_job_type_filter", req.body.apply_job_type_filter);
      formData.append("is_ai_enabled", req.body.is_ai_enabled);
  
      const response = await axios.post(
        "https://vanshjain02-resume-matcher.hf.space/matchjobs",
        formData,
        { headers: formData.getHeaders() }
      );
      res.json(response.data);
    } catch (err) {
      console.error("Error forwarding to Hugging Face:", err.message);
      res.status(500).json({ error: "Job matching failed" });
    }
  });
  

  // Proxy public job listings from Hugging Face
app.get("/api/jobs", async (req, res) => {
    try {
      const response = await axios.get("https://vanshjain02-resume-matcher.hf.space/jobs");
      res.json(response.data);
    } catch (err) {
      console.error("Error fetching jobs:", err.message);
      res.status(500).json({ error: "Failed to fetch jobs" });
    }
  });

  

// Proxy to /match
app.post("/api/match", upload.any(), async (req, res) => {
  try {
    const form = new FormData();
    req.files.forEach(file => {
      form.append(file.fieldname, file.buffer, file.originalname);
    });
    Object.entries(req.body).forEach(([key, value]) => {
      form.append(key, value);
    });

    const response = await axios.post(
      "https://vanshjain02-resume-matcher.hf.space/match",
      form,
      { headers: form.getHeaders() }
    );

    res.json(response.data);
  } catch (err) {
    console.error("Error in /api/match:", err.message);
    res.status(500).json({ error: "Failed to match resume" });
  }
});

// Proxy to /match-ai
app.post("/api/match-ai", upload.any(), async (req, res) => {
  try {
    const form = new FormData();
    req.files.forEach(file => {
      form.append(file.fieldname, file.buffer, file.originalname);
    });
    Object.entries(req.body).forEach(([key, value]) => {
      form.append(key, value);
    });

    const response = await axios.post(
      "https://vanshjain02-resume-matcher.hf.space/match-ai",
      form,
      { headers: form.getHeaders() }
    );

    res.json(response.data);
  } catch (err) {
    console.error("Error in /api/match-ai:", err.message);
    res.status(500).json({ error: "Failed to match resume with AI" });
  }
});
  



app.post('/api/generate-referral', 
    verifyUser, 
    upload.single('resume'),
    async (req, res) => {
      try {
        const { job_desc, comp_name, title, file_path } = req.body;
        const user = req.user;
        const filePath = decodeURIComponent(file_path);
        if (!job_desc || !comp_name || !title) {
          return res.status(400).json({ error: 'Missing required job details' });
        }
  
        let resumeBuffer;
  
        // 1. Check uploaded file
        if (req.file) {
          resumeBuffer = req.file.buffer;
        }
        // 2. If not uploaded, fetch from Supabase using provided file_path
        if (!resumeBuffer && filePath) {
          const { data, error: downloadError } = await supabase
            .storage
            .from('resumes') // <-- Replace with your actual bucket name
            .download(filePath);
          if (downloadError || !data) {
            return res.status(400).json({
              error: 'Could not fetch resume from profile',
              code: 'RESUME_FETCH_FAILED',
              details: downloadError?.message
            });
          }
  
          resumeBuffer = Buffer.from(await data.arrayBuffer());
        }
  
        // 3. If still no resume found
        if (!resumeBuffer) {
          return res.status(400).json({
            error: 'No resume found. Please upload a resume or save one in your profile',
            code: 'RESUME_REQUIRED'
          });
        }
  
        // Prepare payload for AI service
        const form = new FormData();
        form.append('resume', resumeBuffer, { filename: 'resume.pdf' });
        form.append('job_desc', job_desc);
        form.append('comp_name', comp_name);
        form.append('title', title);
  
        const aiResponse = await axios.post(
          process.env.AI_SERVICE_URL || 'https://vanshjain02-resume-matcher.hf.space/generate-referral',
          form,
          {
            headers: form.getHeaders(),
            timeout: 45000
          }
        );
  
        res.json({
          success: true,
          referral_message: aiResponse.data.referral_message,
          model_metadata: {
            model: aiResponse.data.model_used,
            safety_ratings: aiResponse.data.safety_ratings
          }
        });
  
      } catch (error) {
        console.error('[Referral Error]', error);
  
        const status = error.response?.status || 500;
        const message = error.response?.data?.error?.message ||
          'Failed to generate referral message. Please try again.';
  
        res.status(status).json({
          success: false,
          error: message,
          ...(error.response?.data?.details && { details: error.response.data.details })
        });
      }
    }
  );
  

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));