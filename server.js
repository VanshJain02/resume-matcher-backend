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
const { Filter } = require('firebase-admin/firestore');
initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  })
});

const db = getFirestore();

// Cache setup
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 300 }); // 5-minute cache



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
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: (req) => {
      // Higher limits for authenticated users
      return req.user ? 150 : 50; // 150 for logged-in, 50 for anonymous
    },
    keyGenerator: (req) => {
      return req.user ? req.user.uid : req.ip;
    },
    handler: (req, res) => {
      res.status(429).json({
        error: "Too many requests",
        retryAfter: "15 minutes"
      });
    }
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


// Optimized Jobs Endpoint
app.get('/api/jobs', async (req, res) => {
    try {
      const { limit = 30, cursor, roleType, company, title } = req.query;
      const parsedLimit = Math.min(parseInt(limit), 50);
      const cacheKey = `jobs-${JSON.stringify(req.query)}`;
  
      // Check cache first
      const cached = cache.get(cacheKey);
      if (cached) return res.json(cached);
  
      const jobsRef = db.collection('jobs');
      const jobTypes = roleType ? [roleType] : ['Internship', 'Full-time', 'Co-op'];
      let query = jobsRef.where('type', 'in', jobTypes)
                        .orderBy('posted', 'desc');
  
      if (company) {
        query = query.where('company', '>=', company)
                    .where('company', '<=', company + '\uf8ff');
      }
  
      if (title) {
        query = query.where('title', '>=', title)
                    .where('title', '<=', title + '\uf8ff');
      }
  
      if (cursor) {
        query = query.startAfter(cursor);
      }
  
      const snapshot = await query.limit(parsedLimit).get();
      const jobs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        posted: doc.data().posted.toDate().toISOString()
      }));
  
      const response = {
        jobs,
        nextCursor: snapshot.docs[snapshot.docs.length - 1]?.id || null,
        limit: parsedLimit
      };
  
      // Cache results
      cache.set(cacheKey, response);
      res.json(response);
  
    } catch (err) {
      console.error('Error fetching jobs:', err);
      res.status(500).json({ error: 'Failed to fetch jobs', details: err.message });
    }
  });


  // Batched Matches Operations
const matchesBatchHandler = async (req, res, operation) => {
    try {
      const batch = db.batch();
      const matchesRef = db.collection('users').doc(req.user.uid).collection('matches');
  
      if (operation === 'create') {
        const { resumeText, jobDescription, matchResult } = req.body;
        const newDoc = matchesRef.doc();
        batch.set(newDoc, {
          resumeText,
          jobDescription,
          matchResult,
          createdAt: FieldValue.serverTimestamp()
        });
        return { id: newDoc.id };
      }
  
      if (operation === 'delete' && req.params.matchId) {
        batch.delete(matchesRef.doc(req.params.matchId));
      }
  
      await batch.commit();
      return { success: true };
    } catch (err) {
      console.error(`Batch ${operation} error:`, err);
      throw err;
    }
  };

  app.post('/api/matches', verifyUser, async (req, res) => {
    try {
      const result = await matchesBatchHandler(req, res, 'create');
      res.json(result);
    } catch {
      res.status(500).json({ error: 'Failed to save match' });
    }
  });

// app.post('/api/matches', verifyUser, async (req, res) => {
//   try {
//     const { resumeText, jobDescription, matchResult } = req.body;
    
//     const matchesRef = db.collection('users').doc(req.user.uid).collection('matches');
    
//     const docRef = await matchesRef.add({
//       resumeText,
//       jobDescription,
//       matchResult,
//       createdAt: FieldValue.serverTimestamp()
//     });
//     console.log(docRef.id);
//     res.json({ id: docRef.id, success: true });
//   } catch (err) {
//     console.log(err);
//     res.status(500).json({ error: 'Failed to save match' });
//   }
// });

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

// app.delete('/api/matches/:matchId', verifyUser, async (req, res) => {
//     try {
//     const matchRef = db.collection('users').doc(req.user.uid)
//                       .collection('matches').doc(req.params.matchId);
//     await matchRef.delete();

//     res.json({ success: true });
//   } catch (err) {
//     res.status(500).json({ error: 'Failed to delete match' });
//   }
// });
app.delete('/api/matches/:matchId', verifyUser, async (req, res) => {
    try {
      await matchesBatchHandler(req, res, 'delete');
      res.json({ success: true });
    } catch {
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
  


// app.put('/api/profile', verifyUser, async (req, res) => {
//     try {
//       const profileData = req.body;
//       const userRef = db.collection('users').doc(req.user.uid);
//       // Add validation for profile data
//       if (!profileData || typeof profileData !== 'object') {
//         return res.status(400).json({ error: 'Invalid profile data' });
//       }
  
//       // Remove sensitive fields if present
//       delete profileData.roles;
//       delete profileData.permissions;
  
//       await userRef.set(
//         {
//           ...profileData,
//           lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
//         },
//         { merge: true }
//       );
//         res.json({ success: true });
//     } catch (err) {
//         console.error('Error in /api/profile:', err); // 👈 log the actual error

//       res.status(500).json({ error: 'Profile update failed' });
//     }
//   });
  
//   app.get('/api/profile', verifyUser, async (req, res) => {
//     try {
//       const userRef = db.collection('users').doc(req.user.uid);
//       const docSnap = await userRef.get();
      
//       if (!docSnap.exists) {
//         return res.status(404).json({ error: 'Profile not found' });
//       }
  
//       const profileData = docSnap.data();
      
  
//       res.json(profileData);
//     } catch (err) {
//       res.status(500).json({ error: 'Failed to fetch profile' });
//     }
//   });

// Optimized Profile Handling
const profileCache = new NodeCache({ stdTTL: 120 });

app.put('/api/profile', verifyUser, async (req, res) => {
  try {
    const profileData = req.body;
    const userRef = db.collection('users').doc(req.user.uid);
    
    // Only update changed fields
    const updateData = {};
    const currentProfile = profileCache.get(req.user.uid) || {};
    
    Object.keys(profileData).forEach(key => {
      if (profileData[key] !== currentProfile[key]) {
        updateData[key] = profileData[key];
      }
    });

    if (Object.keys(updateData).length > 0) {
      await userRef.update({
        ...updateData,
        lastUpdated: FieldValue.serverTimestamp()
      });
      profileCache.del(req.user.uid);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Profile update failed' });
  }
});

app.get('/api/profile', verifyUser, async (req, res) => {
  try {
    const cacheKey = `profile-${req.user.uid}`;
    const cached = profileCache.get(cacheKey);
    if (cached) return res.json(cached);

    const userRef = db.collection('users').doc(req.user.uid);
    const docSnap = await userRef.get();
    
    if (!docSnap.exists) return res.status(404).json({ error: 'Profile not found' });

    const profileData = docSnap.data();
    profileCache.set(cacheKey, profileData);
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
  app.get('/api/people', async (req, res) => {
    const companyName = req.query.company;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6;
  
    try {
      // Get company ID
      const { data: companies, error: companyError } = await supabase
        .from('companies')
        .select('id')
        .ilike('name', companyName);
  
      if (companyError) throw companyError;
      if (!companies.length) return res.status(404).json({ error: 'Company not found' });
  
      // Calculate pagination
      const startIndex = (page - 1) * limit;
      
      // Get total count
      const { count } = await supabase
        .from('people')
        .select('*', { count: 'exact' })
        .eq('company_id', companies[0].id);
  
      // Get paginated results
      const { data: people, error: peopleError } = await supabase
        .from('people')
        .select('*')
        .eq('company_id', companies[0].id)
        .range(startIndex, startIndex + limit - 1);
  
      if (peopleError) throw peopleError;
  
      res.json({
        people,
        total: count,
        page,
        limit
      });
    } catch (error) {
      console.error('Error fetching people:', error);
      res.status(500).json({ error: error.message });
    }
  });
  

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));