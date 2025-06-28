const multer = require('multer');
const path = require('path');

// Configure multer for local storage (fallback)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter for video files
const fileFilter = (req, file, cb) => {
  // Check if file is a video
  if (file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(new Error('Only video files are allowed!'), false);
  }
};

// Configure multer with limits
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit
    files: 1
  },
  fileFilter: fileFilter
});

// Middleware to handle multer errors
const handleUploadErrors = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        error: 'File too large. Maximum size is 500MB' 
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ 
        error: 'Too many files. Only one file allowed' 
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ 
        error: 'Unexpected file field' 
      });
    }
  }
  
  if (error.message === 'Only video files are allowed!') {
    return res.status(400).json({ error: error.message });
  }
  
  next(error);
};

// Validate video file
const validateVideoFile = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided' });
  }

  // Check file size
  if (req.file.size > 500 * 1024 * 1024) {
    return res.status(400).json({ error: 'File size exceeds 500MB limit' });
  }

  // Check file type
  if (!req.file.mimetype.startsWith('video/')) {
    return res.status(400).json({ error: 'Only video files are allowed' });
  }

  next();
};

module.exports = {
  upload,
  handleUploadErrors,
  validateVideoFile
}; 