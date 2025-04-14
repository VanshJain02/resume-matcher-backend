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
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_KEY
    };

    const firebaseConfig = {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID
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