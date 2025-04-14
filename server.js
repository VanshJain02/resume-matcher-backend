const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Rate limiting (100 requests/15min)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// Secure API Endpoints
app.post('/api/upload', async (req, res) => {
  try {
    // Access protected keys from environment
    const supabaseConfig = {
      url: process.env.REACT_APP_SUPABASE_URL,
      key: process.env.REACT_APP_SUPABASE_KEY
    };

    const firebaseConfig = {
      apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
      authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
      storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: "78745625538",
      appId: "1:78745625538:web:8242b3caa94c9f79c4ec5b",
      measurementId: "G-9N9M6GX9KX"
    };

    // Your business logic here
    res.json({ success: true });
    
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => 
  console.log(`Server running on port ${PORT}`));