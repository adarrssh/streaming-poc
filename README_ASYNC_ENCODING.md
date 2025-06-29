# Asynchronous Video Encoding with CloudWatch Logging

This system has been updated to support asynchronous video encoding with real-time progress tracking via AWS CloudWatch logs.

## Features

- **Asynchronous Processing**: Video encoding runs in the background, allowing immediate API responses
- **Progress Tracking**: Real-time progress updates logged to CloudWatch
- **Status Monitoring**: API endpoints to check encoding status and progress
- **CloudWatch Integration**: Detailed logs for monitoring and debugging

## API Endpoints

### 1. Upload Video
```http
POST /api/upload/video
Content-Type: multipart/form-data

Form data:
- video: Video file
```

**Response:**
```json
{
  "message": "Video uploaded successfully",
  "video": {
    "id": "uuid",
    "filename": "videos/1234567890-uuid.mp4",
    "s3Key": "videos/1234567890-uuid.mp4"
  },
  "nextSteps": {
    "convertToHls": "POST /api/upload/convert-to-hls/{videoId}",
    "body": { "s3Key": "videos/1234567890-uuid.mp4" }
  }
}
```

### 2. Start Encoding (Asynchronous)
```http
POST /api/upload/convert-to-hls/{videoId}
Content-Type: application/json

{
  "s3Key": "videos/1234567890-uuid.mp4"
}
```

**Response:**
```json
{
  "message": "Video encoding started successfully",
  "videoId": "uuid",
  "status": "processing",
  "monitorProgress": "GET /api/upload/status/{videoId}",
  "cloudWatchLogs": "Check CloudWatch logs for video-{videoId} stream"
}
```

### 3. Check Encoding Status
```http
GET /api/upload/status/{videoId}
```

**Response:**
```json
{
  "videoId": "uuid",
  "status": "processing", // processing, completed, failed
  "progress": 45, // 0-100
  "startTime": "2024-01-01T00:00:00.000Z",
  "endTime": "2024-01-01T00:05:00.000Z", // only when completed/failed
  "streamingUrls": { // only when completed
    "master": "https://bucket.s3.amazonaws.com/hls/uuid/master.m3u8",
    "qualities": {
      "360p": "https://bucket.s3.amazonaws.com/hls/uuid/360p/playlist.m3u8",
      "720p": "https://bucket.s3.amazonaws.com/hls/uuid/720p/playlist.m3u8"
    }
  },
  "error": "Error message" // only when failed
}
```

### 4. Get All Active Jobs
```http
GET /api/upload/jobs
```

**Response:**
```json
{
  "totalJobs": 2,
  "jobs": [
    {
      "videoId": "uuid1",
      "status": "processing",
      "progress": 45,
      "startTime": "2024-01-01T00:00:00.000Z"
    },
    {
      "videoId": "uuid2",
      "status": "completed",
      "progress": 100,
      "startTime": "2024-01-01T00:00:00.000Z",
      "endTime": "2024-01-01T00:05:00.000Z"
    }
  ]
}
```

### 5. Get Streaming URLs
```http
GET /api/upload/streaming/{videoId}
```

**Response (if still processing):**
```json
{
  "message": "Video is still being encoded",
  "videoId": "uuid",
  "status": "processing",
  "progress": 45,
  "checkStatus": "GET /api/upload/status/{videoId}"
}
```

**Response (if completed):**
```json
{
  "videoId": "uuid",
  "status": "completed",
  "streamingUrls": {
    "master": "https://bucket.s3.amazonaws.com/hls/uuid/master.m3u8",
    "qualities": {
      "360p": "https://bucket.s3.amazonaws.com/hls/uuid/360p/playlist.m3u8",
      "720p": "https://bucket.s3.amazonaws.com/hls/uuid/720p/playlist.m3u8"
    }
  }
}
```

## CloudWatch Logging

### Log Group
- **Log Group**: `/video-encoding/progress` (configurable via `CLOUDWATCH_LOG_GROUP`)

### Log Streams
- **Stream Name**: `video-{videoId}` (one stream per video)

### Log Format
Each log entry contains:
```json
{
  "videoId": "uuid",
  "message": "Converting to 720p",
  "progress": 55,
  "timestamp": "2024-01-01T00:02:30.000Z"
}
```

### Progress Stages
1. **0%**: Video encoding started
2. **5-10%**: Downloading video from S3
3. **10-40%**: Converting to 360p
4. **40-70%**: Converting to 720p
5. **70-90%**: Uploading HLS files to S3
6. **90-100%**: Generating master playlist
7. **100%**: Video encoding completed successfully

## Environment Variables

Add these to your `.env` file:

```bash
# CloudWatch Configuration
CLOUDWATCH_LOG_GROUP=/video-encoding/progress

# AWS Configuration (existing)
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-video-bucket-name
```

## AWS IAM Permissions

Ensure your AWS credentials have these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/video-encoding/progress:*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    }
  ]
}
```

## Usage Example

```javascript
// 1. Upload video
const uploadResponse = await fetch('/api/upload/video', {
  method: 'POST',
  body: formData
});
const { video } = await uploadResponse.json();

// 2. Start encoding
const encodingResponse = await fetch(`/api/upload/convert-to-hls/${video.id}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ s3Key: video.s3Key })
});
const { videoId } = await encodingResponse.json();

// 3. Monitor progress
const checkProgress = async () => {
  const statusResponse = await fetch(`/api/upload/status/${videoId}`);
  const status = await statusResponse.json();
  
  console.log(`Progress: ${status.progress}%`);
  
  if (status.status === 'processing') {
    setTimeout(checkProgress, 5000); // Check again in 5 seconds
  } else if (status.status === 'completed') {
    console.log('Encoding completed!', status.streamingUrls);
  } else {
    console.error('Encoding failed:', status.error);
  }
};

checkProgress();
```

## Benefits

1. **Non-blocking API**: Immediate response after starting encoding
2. **Real-time Progress**: Track encoding progress via API or CloudWatch
3. **Scalable**: Multiple videos can be encoded simultaneously
4. **Monitoring**: CloudWatch logs provide detailed insights
5. **Error Handling**: Comprehensive error tracking and reporting 