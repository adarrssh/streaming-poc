const videoProcessor = require('./videoProcessor');
const cloudWatchLogger = require('./cloudWatchLogger');

class BackgroundProcessor {
  constructor() {
    this.activeJobs = new Map(); // Track active encoding jobs
  }

  async startEncodingJob(videoId, s3Key) {
    try {
      // Check if job is already running
      if (this.activeJobs.has(videoId)) {
        throw new Error('Video encoding job already in progress');
      }

      // Mark job as active
      this.activeJobs.set(videoId, {
        status: 'processing',
        startTime: new Date(),
        progress: 0
      });

      // Log start
      await cloudWatchLogger.logStart(videoId, s3Key);

      // Start processing in background
      this.processVideo(videoId, s3Key);

      return {
        success: true,
        videoId,
        message: 'Video encoding started successfully',
        status: 'processing'
      };

    } catch (error) {
      console.error(`Error starting encoding job for ${videoId}:`, error);
      this.activeJobs.delete(videoId);
      throw error;
    }
  }

  async processVideo(videoId, s3Key) {
    try {
      // Update progress tracking
      const job = this.activeJobs.get(videoId);
      if (!job) return;

      // Download phase (10% of total progress)
      await cloudWatchLogger.logDownload(videoId, 5);
      job.progress = 5;
      
      const localVideoPath = await videoProcessor.downloadFromS3(s3Key);
      await cloudWatchLogger.logDownload(videoId, 10);
      job.progress = 10;

      // Conversion phase (70% of total progress)
      const outputDir = await videoProcessor.prepareOutputDir(videoId);
      
      // Convert to different qualities with progress tracking
      const qualities = [
        { name: "360p", resolution: "640x360", bitrate: "500k" },
        { name: "720p", resolution: "1280x720", bitrate: "2000k" }
      ];

      for (let i = 0; i < qualities.length; i++) {
        const quality = qualities[i];
        const qualityProgress = 10 + (i * 30) + 15; // 10% base + 30% per quality + 15% for current quality
        
        await cloudWatchLogger.logConversion(videoId, quality.name, qualityProgress);
        job.progress = qualityProgress;
        
        await videoProcessor.convertQuality(localVideoPath, outputDir, quality);
        
        await cloudWatchLogger.logConversion(videoId, quality.name, qualityProgress + 15);
        job.progress = qualityProgress + 15;
      }

      // Upload phase (20% of total progress)
      await cloudWatchLogger.logUpload(videoId, 80);
      job.progress = 80;
      
      const s3Prefix = `hls/${videoId}`;
      await videoProcessor.uploadToS3(outputDir, s3Prefix);
      
      await cloudWatchLogger.logUpload(videoId, 90);
      job.progress = 90;

      // Generate master playlist
      const masterS3Key = await videoProcessor.generateMasterPlaylist(outputDir, s3Prefix, videoId);
      
      const streamingUrls = {
        master: `https://${process.env.BUCKET_NAME}.s3.amazonaws.com/${masterS3Key}`,
        qualities: {
          "360p": `https://${process.env.BUCKET_NAME}.s3.amazonaws.com/${s3Prefix}/360p/playlist.m3u8`,
          "720p": `https://${process.env.BUCKET_NAME}.s3.amazonaws.com/${s3Prefix}/720p/playlist.m3u8`
        }
      };

      // Cleanup
      await videoProcessor.cleanup(localVideoPath, outputDir);

      // Mark as complete
      await cloudWatchLogger.logComplete(videoId, streamingUrls);
      job.progress = 100;
      job.status = 'completed';
      job.endTime = new Date();
      job.streamingUrls = streamingUrls;

      console.log(`✅ Video encoding completed for ${videoId}`);

    } catch (error) {
      console.error(`❌ Error processing video ${videoId}:`, error);
      
      const job = this.activeJobs.get(videoId);
      if (job) {
        job.status = 'failed';
        job.error = error.message;
        job.endTime = new Date();
      }

      await cloudWatchLogger.logError(videoId, error);
    }
  }

  getJobStatus(videoId) {
    const job = this.activeJobs.get(videoId);
    if (!job) {
      return { status: 'not_found', message: 'Job not found' };
    }

    return {
      videoId,
      status: job.status,
      progress: job.progress,
      startTime: job.startTime,
      endTime: job.endTime,
      streamingUrls: job.streamingUrls,
      error: job.error
    };
  }

  getAllJobs() {
    const jobs = [];
    for (const [videoId, job] of this.activeJobs) {
      jobs.push({
        videoId,
        status: job.status,
        progress: job.progress,
        startTime: job.startTime,
        endTime: job.endTime
      });
    }
    return jobs;
  }

  cleanupCompletedJobs() {
    const completedJobs = [];
    for (const [videoId, job] of this.activeJobs) {
      if (job.status === 'completed' || job.status === 'failed') {
        // Keep completed jobs for 1 hour for status checking
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        if (job.endTime && job.endTime < oneHourAgo) {
          completedJobs.push(videoId);
        }
      }
    }
    
    completedJobs.forEach(videoId => {
      this.activeJobs.delete(videoId);
    });

    if (completedJobs.length > 0) {
      console.log(`🧹 Cleaned up ${completedJobs.length} completed jobs`);
    }
  }
}

module.exports = new BackgroundProcessor(); 