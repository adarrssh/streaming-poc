# ✅ **FULLY TESTED  EC2 READY**

# Video Upload & Processing Service

A Node.js service for uploading videos to AWS S3 and converting them to HLS format for streaming with multiple quality levels (360p, 720p).

## Features

- Video upload to AWS S3
- HLS video conversion with multiple qualities
- Streaming URLs generation
- EC2 optimized processing
- Pre-signed URL uploads

## Prerequisites

- AWS EC2 instance (t3.medium or larger recommended)
- AWS S3 bucket with proper permissions
- Node.js 18+ installed on EC2

## EC2 Setup

### 1. Connect to your EC2 instance

```bash
ssh -i your-key.pem ec2-user@your-ec2-ip
```

### 2. Clone the repository

```bash
git clone <your-repo-url>
cd video-encoding
```

### 3. Run the setup script

```bash
chmod +x setup-ec2.sh
./setup-ec2.sh
```

### 4. Configure environment variables

Edit the `.env` file with your AWS credentials:

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_S3_BUCKET=your-bucket-name
PORT=3000
NODE_ENV=production
```

### 5. Configure S3 Bucket

Add this bucket policy to allow public read access for HLS files:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::your-bucket-name/hls/*"
        }
    ]
}
```

### 6. Configure EC2 Security Group

Allow inbound traffic on port 3000 (or your chosen port) from your IP address.

### 7. Start the service

```bash
npm start
```

## API Endpoints

### 1. Upload Video

**POST** `/api/upload/video`

Upload a video file directly to S3.

```bash
curl -X POST http://your-ec2-ip:3000/api/upload/video \
  -F "video=@your-video.mp4"
```

**Response:**
```json
{
  "message": "Video uploaded successfully",
  "video": {
    "id": "video-uuid",
    "filename": "videos/1234567890-abc123.mp4",
    "originalName": "your-video.mp4",
    "size": 1234567,
    "mimetype": "video/mp4",
    "url": "https://bucket.s3.amazonaws.com/videos/1234567890-abc123.mp4",
    "uploadedAt": "2024-01-01T00:00:00.000Z",
    "s3Key": "videos/1234567890-abc123.mp4"
  },
  "nextSteps": {
    "convertToHls": "POST /api/upload/convert-to-hls/video-uuid",
    "body": { "s3Key": "videos/1234567890-abc123.mp4" }
  }
}
```

### 2. Convert to HLS

**POST** `/api/upload/convert-to-hls/:videoId`

Convert the uploaded video to HLS format.

```bash
curl -X POST http://your-ec2-ip:3000/api/upload/convert-to-hls/video-uuid \
  -H "Content-Type: application/json" \
  -d '{"s3Key": "videos/1234567890-abc123.mp4"}'
```

**Response:**
```json
{
  "message": "Video converted to HLS successfully",
  "videoId": "video-uuid",
  "masterPlaylist": "hls/video-uuid/master.m3u8",
  "streamingUrls": {
    "master": "https://bucket.s3.amazonaws.com/hls/video-uuid/master.m3u8",
    "qualities": {
      "360p": "https://bucket.s3.amazonaws.com/hls/video-uuid/360p/playlist.m3u8",
      "720p": "https://bucket.s3.amazonaws.com/hls/video-uuid/720p/playlist.m3u8"
    }
  }
}
```

### 3. Get Streaming URLs

**GET** `/api/upload/streaming/:videoId`

Get streaming URLs for a converted video.

```bash
curl http://your-ec2-ip:3000/api/upload/streaming/video-uuid
```

**Response:**
```json
{
  "videoId": "video-uuid",
  "streamingUrls": {
    "master": "https://bucket.s3.amazonaws.com/hls/video-uuid/master.m3u8",
    "qualities": {
      "360p": "https://bucket.s3.amazonaws.com/hls/video-uuid/360p/playlist.m3u8",
      "720p": "https://bucket.s3.amazonaws.com/hls/video-uuid/720p/playlist.m3u8"
    }
  }
}
```

### 4. Generate Pre-signed URL

**POST** `/api/upload/presigned-url`

Generate a pre-signed URL for direct upload to S3.

```bash
curl -X POST http://your-ec2-ip:3000/api/upload/presigned-url \
  -H "Content-Type: application/json" \
  -d '{"filename": "video.mp4", "contentType": "video/mp4"}'
```

### 5. Check Upload Status

**GET** `/api/upload/status/:key`

Check if a file exists in S3.

```bash
curl http://your-ec2-ip:3000/api/upload/status/videos/1234567890-abc123.mp4
```

## S3 File Structure

After processing, your S3 bucket will contain:

```
your-bucket/
├── videos/
│   └── original-video.mp4
└── hls/
    └── {videoId}/
        ├── master.m3u8
        ├── 360p/
        │   ├── playlist.m3u8
        │   └── segment_000.ts, segment_001.ts, ...
        └── 720p/
            ├── playlist.m3u8
            └── segment_000.ts, segment_001.ts, ...
```

## Testing the Streaming

### Using VLC Media Player

1. Open VLC Media Player
2. Go to Media → Open Network Stream
3. Enter the master.m3u8 URL
4. Click Play

### Using Online HLS Player

Visit https://hls-js.netlify.app/demo/ and paste your master.m3u8 URL.

### Using HTML5 Video Player

```html
<!DOCTYPE html>
<html>
<head>
    <title>HLS Video Player</title>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
</head>
<body>
    <video id="video" controls></video>
    <script>
        const video = document.getElementById('video');
        const videoSrc = 'https://your-bucket.s3.amazonaws.com/hls/video-uuid/master.m3u8';
        
        if (Hls.isSupported()) {
            const hls = new Hls();
            hls.loadSource(videoSrc);
            hls.attachMedia(video);
        }
        else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = videoSrc;
        }
    </script>
</body>
</html>
```

## Troubleshooting

### FFmpeg Not Found

If you get "FFmpeg not found" errors:

```bash
# Check if FFmpeg is installed
which ffmpeg

# If not found, install it manually
sudo yum install -y ffmpeg ffmpeg-devel
```

### Permission Denied

If you get permission errors:

```bash
# Fix temp directory permissions
sudo chmod 755 /tmp/video-processing
sudo chown ec2-user:ec2-user /tmp/video-processing
```

### S3 Access Denied

Check your AWS credentials and S3 bucket permissions:

```bash
# Test S3 access
aws s3 ls s3://your-bucket-name
```

### High CPU Usage

Video processing is CPU-intensive. Consider:

- Using larger EC2 instance types (t3.large, t3.xlarge)
- Processing videos during off-peak hours
- Implementing a job queue for background processing

## Performance Optimization

### EC2 Instance Recommendations

- **t3.medium**: Good for testing and small videos
- **t3.large**: Better for 720p processing
- **t3.xlarge**: Recommended for 1080p+ processing

### Monitoring

Monitor your EC2 instance during video processing:

```bash
# Check CPU usage
top

# Check disk usage
df -h

# Check memory usage
free -h
```

## Security Considerations

1. **Restrict S3 bucket access** to only necessary files
2. **Use IAM roles** instead of access keys when possible
3. **Implement rate limiting** for upload endpoints
4. **Validate file types** and sizes
5. **Use HTTPS** for all API communications

## License

MIT 