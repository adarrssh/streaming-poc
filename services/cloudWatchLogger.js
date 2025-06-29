const { CloudWatchLogsClient, PutLogEventsCommand, CreateLogStreamCommand, DescribeLogStreamsCommand, CreateLogGroupCommand, DescribeLogGroupsCommand } = require('@aws-sdk/client-cloudwatch-logs');

class CloudWatchLogger {
  constructor() {
    this.client = new CloudWatchLogsClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    this.logGroupName = process.env.CLOUDWATCH_LOG_GROUP || '/video-encoding/progress';
    this.sequenceToken = null;
  }

  async ensureLogGroup() {
    try {
      // Check if log group exists
      const describeCommand = new DescribeLogGroupsCommand({
        logGroupNamePrefix: this.logGroupName
      });
      
      const groups = await this.client.send(describeCommand);
      const existingGroup = groups.logGroups?.find(group => group.logGroupName === this.logGroupName);
      
      if (!existingGroup) {
        // Create new log group
        const createCommand = new CreateLogGroupCommand({
          logGroupName: this.logGroupName
        });
        await this.client.send(createCommand);
        console.log(`✅ Created CloudWatch log group: ${this.logGroupName}`);
      } else {
        console.log(`📊 Using existing CloudWatch log group: ${this.logGroupName}`);
      }
    } catch (error) {
      console.error('❌ Error ensuring log group:', error);
      console.error('   Error details:', {
        name: error.name,
        message: error.message,
        code: error.$metadata?.httpStatusCode,
        requestId: error.$metadata?.requestId
      });
      throw error;
    }
  }

  async ensureLogStream(videoId) {
    const streamName = `video-${videoId}`;
    
    try {
      // First ensure log group exists
      await this.ensureLogGroup();
      
      // Check if stream exists
      const describeCommand = new DescribeLogStreamsCommand({
        logGroupName: this.logGroupName,
        logStreamNamePrefix: streamName
      });
      
      const streams = await this.client.send(describeCommand);
      const existingStream = streams.logStreams?.find(stream => stream.logStreamName === streamName);
      
      if (!existingStream) {
        // Create new stream
        const createCommand = new CreateLogStreamCommand({
          logGroupName: this.logGroupName,
          logStreamName: streamName
        });
        await this.client.send(createCommand);
        this.sequenceToken = null;
        console.log(`✅ Created CloudWatch log stream: ${streamName}`);
      } else {
        this.sequenceToken = existingStream.uploadSequenceToken;
        console.log(`📊 Using existing CloudWatch log stream: ${streamName}`);
      }
      
      return streamName;
    } catch (error) {
      console.error('❌ Error ensuring log stream:', error);
      console.error('   Error details:', {
        name: error.name,
        message: error.message,
        code: error.$metadata?.httpStatusCode,
        requestId: error.$metadata?.requestId,
        videoId: videoId,
        streamName: streamName
      });
      throw error;
    }
  }

  async logProgress(videoId, message, progress = null) {
    try {
      const streamName = await this.ensureLogStream(videoId);
      
      const logEvent = {
        timestamp: Date.now(),
        message: JSON.stringify({
          videoId,
          message,
          progress,
          timestamp: new Date().toISOString()
        })
      };

      const putLogCommand = new PutLogEventsCommand({
        logGroupName: this.logGroupName,
        logStreamName: streamName,
        logEvents: [logEvent],
        sequenceToken: this.sequenceToken
      });

      const result = await this.client.send(putLogCommand);
      this.sequenceToken = result.nextSequenceToken;
      
      console.log(`[${videoId}] Progress: ${message}${progress ? ` (${progress}%)` : ''}`);
    } catch (error) {
      console.error('❌ Error logging progress:', error);
      console.error('   Error details:', {
        name: error.name,
        message: error.message,
        code: error.$metadata?.httpStatusCode,
        requestId: error.$metadata?.requestId,
        videoId: videoId,
        message: message,
        progress: progress
      });
      // Don't throw error to avoid breaking the main process
    }
  }

  async logStart(videoId, s3Key) {
    console.log(`🚀 Starting video encoding for ${videoId}`);
    await this.logProgress(videoId, 'Video encoding started', 0);
  }

  async logDownload(videoId, progress) {
    console.log(`📥 Download progress for ${videoId}: ${progress}%`);
    await this.logProgress(videoId, 'Downloading video from S3', progress);
  }

  async logConversion(videoId, quality, progress) {
    console.log(`🔄 Conversion progress for ${videoId} (${quality}): ${progress}%`);
    await this.logProgress(videoId, `Converting to ${quality}`, progress);
  }

  async logUpload(videoId, progress) {
    console.log(`📤 Upload progress for ${videoId}: ${progress}%`);
    await this.logProgress(videoId, 'Uploading HLS files to S3', progress);
  }

  async logComplete(videoId, streamingUrls) {
    console.log(`✅ Video encoding completed for ${videoId}`);
    await this.logProgress(videoId, 'Video encoding completed successfully', 100);
  }

  async logError(videoId, error) {
    console.error(`❌ Error in video encoding for ${videoId}:`, error.message);
    console.error('   Full error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      videoId: videoId
    });
    await this.logProgress(videoId, `Error: ${error.message}`, null);
  }
}

module.exports = new CloudWatchLogger(); 