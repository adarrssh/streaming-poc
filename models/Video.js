const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
  videoId: {
    type: String,
    required: true,
    unique: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  filename: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  mimetype: {
    type: String,
    required: true
  },
  url: {
    type: String,
    required: true
  },
  s3Key: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['uploaded', 'processing', 'completed', 'failed'],
    default: 'uploaded'
  },
  encodingProgress: {
    type: Number,
    default: 0
  },
  streamingUrls: {
    master: String,
    qualities: {
      '360p': String,
      '720p': String
    }
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  s3Metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  displayName: {
    type: String,
    default: ''
  },
  encodingStartedAt: {
    type: Date,
    default: null
  },
  encodingCompletedAt: {
    type: Date,
    default: null
  },
  error: {
    type: String,
    default: null
  }
}, {
  timestamps: true // Adds createdAt and updatedAt fields
});

// Index for faster queries
videoSchema.index({ userId: 1, createdAt: -1 });
videoSchema.index({ videoId: 1 });
videoSchema.index({ status: 1 });

// Instance method to get video data without sensitive information
videoSchema.methods.toJSON = function() {
  const videoObject = this.toObject();
  return videoObject;
};

module.exports = mongoose.model('Video', videoSchema); 