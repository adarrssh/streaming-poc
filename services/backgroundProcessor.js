const videoProcessor = require('./videoProcessor');
const cloudWatchLogger = require('./cloudWatchLogger');
const Video = require('../models/Video');
const { BUCKET_NAME } = require('../config/aws');

class BackgroundProcessor {
  constructor() {
    this.activeJobs = new Map(); // Track active encoding jobs
  }

  async startEncodingJob(videoId, s3Key) {
    try {
      console.log(`🚀 Starting encoding job for video: ${videoId}`);
      console.log(`📁 S3 Key: ${s3Key}`);
      
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
      console.error(`❌ Error starting encoding job for ${videoId}:`, error);
      console.error('   Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        videoId: videoId,
        s3Key: s3Key
      });
      this.activeJobs.delete(videoId);
      throw error;
    }
  }

  async processVideo(videoId, s3Key) {
    let localVideoPath = null;
    let outputDir = null;
    
    try {
      console.log(`🔄 Starting video processing for ${videoId}`);
      
      // Update progress tracking
      const job = this.activeJobs.get(videoId);
      if (!job) {
        throw new Error('Job not found in active jobs');
      }

      // Download phase (10% of total progress)
      console.log(`📥 Starting download phase for ${videoId}`);
      await cloudWatchLogger.logDownload(videoId, 5);
      job.progress = 5;
      
      // Update database with progress
      try {
        await Video.findOneAndUpdate(
          { videoId: videoId },
          { encodingProgress: 5 }
        );
      } catch (dbError) {
        console.warn(`⚠️ Failed to update progress in database for ${videoId}:`, dbError);
      }
      
      try {
        localVideoPath = await videoProcessor.downloadFromS3(s3Key);
        console.log(`✅ Download completed for ${videoId}: ${localVideoPath}`);
      } catch (downloadError) {
        console.error(`❌ Download failed for ${videoId}:`, downloadError);
        throw new Error(`Failed to download video from S3: ${downloadError.message}`);
      }
      
      await cloudWatchLogger.logDownload(videoId, 10);
      job.progress = 10;

      // Conversion phase (70% of total progress)
      console.log(`🔄 Starting conversion phase for ${videoId}`);
      try {
        outputDir = await videoProcessor.prepareOutputDir(videoId);
        console.log(`✅ Output directory prepared: ${outputDir}`);
      } catch (dirError) {
        console.error(`❌ Failed to prepare output directory for ${videoId}:`, dirError);
        throw new Error(`Failed to prepare output directory: ${dirError.message}`);
      }
      
      // Convert to different qualities with progress tracking
      const qualities = [
        { name: "360p", resolution: "640x360", bitrate: "500k" },
        { name: "720p", resolution: "1280x720", bitrate: "2000k" }
      ];

      for (let i = 0; i < qualities.length; i++) {
        const quality = qualities[i];
        const qualityProgress = 10 + (i * 30) + 15; // 10% base + 30% per quality + 15% for current quality
        
        console.log(`🔄 Starting ${quality.name} conversion for ${videoId}`);
        await cloudWatchLogger.logConversion(videoId, quality.name, qualityProgress);
        job.progress = qualityProgress;
        
        // Update database with progress
        try {
          await Video.findOneAndUpdate(
            { videoId: videoId },
            { encodingProgress: qualityProgress }
          );
        } catch (dbError) {
          console.warn(`⚠️ Failed to update progress in database for ${videoId}:`, dbError);
        }
        
        try {
          await videoProcessor.convertQuality(localVideoPath, outputDir, quality);
          console.log(`✅ ${quality.name} conversion completed for ${videoId}`);
        } catch (conversionError) {
          console.error(`❌ ${quality.name} conversion failed for ${videoId}:`, conversionError);
          throw new Error(`Failed to convert to ${quality.name}: ${conversionError.message}`);
        }
        
        await cloudWatchLogger.logConversion(videoId, quality.name, qualityProgress + 15);
        job.progress = qualityProgress + 15;
        
        // Update database with progress
        try {
          await Video.findOneAndUpdate(
            { videoId: videoId },
            { encodingProgress: qualityProgress + 15 }
          );
        } catch (dbError) {
          console.warn(`⚠️ Failed to update progress in database for ${videoId}:`, dbError);
        }
      }

      // Upload phase (20% of total progress)
      console.log(`📤 Starting upload phase for ${videoId}`);
      await cloudWatchLogger.logUpload(videoId, 80);
      job.progress = 80;
      
      // Update database with progress
      try {
        await Video.findOneAndUpdate(
          { videoId: videoId },
          { encodingProgress: 80 }
        );
      } catch (dbError) {
        console.warn(`⚠️ Failed to update progress in database for ${videoId}:`, dbError);
      }
      
      const s3Prefix = `hls/${videoId}`;
      try {
        await videoProcessor.uploadToS3(outputDir, s3Prefix);
        console.log(`✅ S3 upload completed for ${videoId}`);
      } catch (uploadError) {
        console.error(`❌ S3 upload failed for ${videoId}:`, uploadError);
        throw new Error(`Failed to upload HLS files to S3: ${uploadError.message}`);
      }
      
      await cloudWatchLogger.logUpload(videoId, 90);
      job.progress = 90;
      
      // Update database with progress
      try {
        await Video.findOneAndUpdate(
          { videoId: videoId },
          { encodingProgress: 90 }
        );
      } catch (dbError) {
        console.warn(`⚠️ Failed to update progress in database for ${videoId}:`, dbError);
      }

      // Generate master playlist
      console.log(`📋 Generating master playlist for ${videoId}`);
      let masterS3Key;
      try {
        masterS3Key = await videoProcessor.generateMasterPlaylist(outputDir, s3Prefix, videoId);
        console.log(`✅ Master playlist generated: ${masterS3Key}`);
      } catch (playlistError) {
        console.error(`❌ Master playlist generation failed for ${videoId}:`, playlistError);
        throw new Error(`Failed to generate master playlist: ${playlistError.message}`);
      }
      
      const streamingUrls = {
        master: `https://${BUCKET_NAME}.s3.amazonaws.com/${masterS3Key}`,
        qualities: {
          "360p": `https://${BUCKET_NAME}.s3.amazonaws.com/${s3Prefix}/360p/playlist.m3u8`,
          "720p": `https://${BUCKET_NAME}.s3.amazonaws.com/${s3Prefix}/720p/playlist.m3u8`
        }
      };

      // Cleanup
      console.log(`🧹 Starting cleanup for ${videoId}`);
      try {
        await videoProcessor.cleanup(localVideoPath, outputDir);
        console.log(`✅ Cleanup completed for ${videoId}`);
      } catch (cleanupError) {
        console.warn(`⚠️ Cleanup warning for ${videoId}:`, cleanupError);
        // Don't throw error for cleanup failures
      }

      // Mark as complete
      await cloudWatchLogger.logComplete(videoId, streamingUrls);
      job.progress = 100;
      job.status = 'completed';
      job.endTime = new Date();
      job.streamingUrls = streamingUrls;

      // Update video status in database
      try {
        await Video.findOneAndUpdate(
          { videoId: videoId },
          {
            status: 'completed',
            encodingProgress: 100,
            encodingCompletedAt: new Date(),
            streamingUrls: streamingUrls,
            error: null
          }
        );
        console.log(`✅ Database updated for ${videoId}`);
      } catch (dbError) {
        console.warn(`⚠️ Failed to update database for ${videoId}:`, dbError);
        // Don't throw error for database update failures
      }

      console.log(`🎉 Video encoding completed successfully for ${videoId}`);
      console.log(`📺 Streaming URLs:`, streamingUrls);

    } catch (error) {
      console.error(`❌ Error processing video ${videoId}:`, error);
      console.error('   Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack,
        videoId: videoId,
        s3Key: s3Key,
        localVideoPath: localVideoPath,
        outputDir: outputDir
      });
      
      const job = this.activeJobs.get(videoId);
      if (job) {
        job.status = 'failed';
        job.error = error.message;
        job.endTime = new Date();
      }

      // Update video status in database
      try {
        await Video.findOneAndUpdate(
          { videoId: videoId },
          {
            status: 'failed',
            encodingProgress: job ? job.progress : 0,
            error: error.message
          }
        );
        console.log(`✅ Database updated for failed ${videoId}`);
      } catch (dbError) {
        console.warn(`⚠️ Failed to update database for failed ${videoId}:`, dbError);
        // Don't throw error for database update failures
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