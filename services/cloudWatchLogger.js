const { CloudWatchLogsClient, PutLogEventsCommand, CreateLogStreamCommand, DescribeLogStreamsCommand } = require('@aws-sdk/client-cloudwatch-logs');

class CloudWatchLogger {
  constructor() {
    this.client = new CloudWatchLogsClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    this.logGroupName = process.env.CLOUDWATCH_LOG_GROUP || '/video-encoding/progress';
    this.sequenceToken = null;
  }

  async ensureLogStream(videoId) {
    const streamName = `video-${videoId}`;
    
    try {
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
      } else {
        this.sequenceToken = existingStream.uploadSequenceToken;
      }
      
      return streamName;
    } catch (error) {
      console.error('Error ensuring log stream:', error);
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
      console.error('Error logging progress:', error);
      // Don't throw error to avoid breaking the main process
    }
  }

  async logStart(videoId, s3Key) {
    await this.logProgress(videoId, 'Video encoding started', 0);
  }

  async logDownload(videoId, progress) {
    await this.logProgress(videoId, 'Downloading video from S3', progress);
  }

  async logConversion(videoId, quality, progress) {
    await this.logProgress(videoId, `Converting to ${quality}`, progress);
  }

  async logUpload(videoId, progress) {
    await this.logProgress(videoId, 'Uploading HLS files to S3', progress);
  }

  async logComplete(videoId, streamingUrls) {
    await this.logProgress(videoId, 'Video encoding completed successfully', 100);
  }

  async logError(videoId, error) {
    await this.logProgress(videoId, `Error: ${error.message}`, null);
  }
}

module.exports = new CloudWatchLogger(); 