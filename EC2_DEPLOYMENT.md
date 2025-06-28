# EC2 Deployment Guide for Video Processing Service (Ubuntu)

## ✅ **Pre-Tested & Working**
This service has been fully tested locally and is ready for EC2 deployment on Ubuntu.

## **Step 1: Connect to Your EC2 Instance**

```bash
ssh -i your-key.pem ubuntu@your-ec2-public-ip
```

## **Step 2: Install Prerequisites**

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Node.js using NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18

# Install FFmpeg
sudo apt install -y ffmpeg

# Verify installations
node --version
npm --version
ffmpeg -version
```

## **Step 3: Clone and Setup Project**

```bash
# Clone your repository
git clone https://github.com/yourusername/video-encoding.git
cd video-encoding

# Install dependencies
npm install

# Create temp directory with proper permissions
sudo mkdir -p /tmp/video-processing
sudo chmod 755 /tmp/video-processing
sudo chown ubuntu:ubuntu /tmp/video-processing
```

## **Step 4: Configure Environment Variables**

```bash
# Create .env file
nano .env
```

Add your AWS credentials:
```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_S3_BUCKET=your-s3-bucket-name
PORT=3000
NODE_ENV=production
```

## **Step 5: Configure S3 Bucket**

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

## **Step 6: Configure EC2 Security Group**

In AWS Console:
1. Go to EC2 → Security Groups
2. Select your EC2 instance's security group
3. Add inbound rule:
   - **Type**: Custom TCP
   - **Port**: 3000
   - **Source**: Your IP address (or 0.0.0.0/0 for testing)

## **Step 7: Start the Server**

```bash
# Start the server
npm start
```

You should see:
```
🚀 Server running on port 3000
📤 Video upload service ready
🔗 Health check: http://localhost:3000/health
```

## **Step 8: Test the API**

### **Test 1: Health Check**
```bash
curl http://your-ec2-ip:3000/health
```

### **Test 2: Upload Video**
```bash
curl -X POST http://your-ec2-ip:3000/api/upload/video \
  -H "Content-Type: multipart/form-data" \
  -F "video=@/path/to/your/video.mp4;type=video/mp4"
```

### **Test 3: Convert to HLS**
```bash
# Use the video ID and S3 key from the upload response
curl -X POST http://your-ec2-ip:3000/api/upload/convert-to-hls/YOUR_VIDEO_ID \
  -H "Content-Type: application/json" \
  -d '{"s3Key": "YOUR_S3_KEY"}'
```

### **Test 4: Get Streaming URLs**
```bash
curl http://your-ec2-ip:3000/api/upload/streaming/YOUR_VIDEO_ID
```

## **Step 9: Production Deployment (Optional)**

### **Using PM2 for Process Management**
```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start server.js --name "video-processing"

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

### **Using Systemd Service**
```bash
# Create systemd service file
sudo nano /etc/systemd/system/video-processing.service
```

Add this content:
```ini
[Unit]
Description=Video Processing Service
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/video-encoding
ExecStart=/home/ubuntu/.nvm/versions/node/v18.x.x/bin/node server.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl enable video-processing
sudo systemctl start video-processing
sudo systemctl status video-processing
```

## **Step 10: Monitoring**

### **Check Server Status**
```bash
# Check if server is running
curl http://localhost:3000/health

# Check process
ps aux | grep node

# Check logs
tail -f /var/log/video-processing.log
```

### **Monitor Video Processing**
```bash
# Check temp directory
ls -la /tmp/video-processing/

# Monitor CPU usage during processing
top

# Check disk usage
df -h
```

## **Troubleshooting**

### **FFmpeg Not Found**
```bash
# Check FFmpeg installation
which ffmpeg

# Reinstall if needed
sudo apt update
sudo apt install -y ffmpeg
```

### **Permission Issues**
```bash
# Fix temp directory permissions
sudo chmod 755 /tmp/video-processing
sudo chown ubuntu:ubuntu /tmp/video-processing
```

### **S3 Access Issues**
```bash
# Test S3 access
aws s3 ls s3://your-bucket-name

# Check AWS credentials
aws sts get-caller-identity
```

### **Port Issues**
```bash
# Check if port is open
netstat -tlnp | grep 3000

# Check security group
aws ec2 describe-security-groups --group-ids sg-xxxxxxxxx
```

## **Performance Optimization**

### **EC2 Instance Recommendations**
- **t3.medium**: Good for testing and small videos
- **t3.large**: Better for 720p processing
- **t3.xlarge**: Recommended for 1080p+ processing

### **S3 Optimization**
- Enable S3 Transfer Acceleration for faster uploads
- Use CloudFront for better streaming performance
- Consider S3 Intelligent Tiering for cost optimization

## **Security Considerations**

1. **Use IAM roles** instead of access keys when possible
2. **Restrict S3 bucket access** to only necessary files
3. **Implement rate limiting** (already configured)
4. **Use HTTPS** for all API communications
5. **Regular security updates** for the EC2 instance

## **API Endpoints Summary**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/upload/video` | POST | Upload video |
| `/api/upload/convert-to-hls/:videoId` | POST | Convert to HLS |
| `/api/upload/streaming/:videoId` | GET | Get streaming URLs |
| `/api/upload/presigned-url` | POST | Generate upload URL |
| `/api/upload/status/:key` | GET | Check upload status |

## **Expected Response Format**

### **Upload Response**
```json
{
  "message": "Video uploaded successfully",
  "video": {
    "id": "video-uuid",
    "s3Key": "videos/timestamp-uuid.mp4"
  },
  "nextSteps": {
    "convertToHls": "POST /api/upload/convert-to-hls/video-uuid",
    "body": { "s3Key": "videos/timestamp-uuid.mp4" }
  }
}
```

### **HLS Conversion Response**
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

## **Success! 🎉**

Your video processing service is now ready for production use on EC2 Ubuntu. The system will:
- ✅ Upload videos to S3
- ✅ Convert them to HLS format with multiple qualities
- ✅ Generate streaming URLs
- ✅ Handle errors gracefully
- ✅ Clean up temporary files automatically 