# Ubuntu EC2 Deployment - Quick Start

## **Key Differences from Amazon Linux:**

| Component | Amazon Linux | Ubuntu |
|-----------|-------------|--------|
| **User** | `ec2-user` | `ubuntu` |
| **Package Manager** | `yum` | `apt` |
| **SSH Command** | `ssh -i key.pem ec2-user@ip` | `ssh -i key.pem ubuntu@ip` |
| **FFmpeg Install** | `sudo yum install -y ffmpeg` | `sudo apt install -y ffmpeg` |

## **Quick Ubuntu Commands:**

### **1. Connect & Setup**
```bash
ssh -i your-key.pem ubuntu@your-ec2-ip
sudo apt update && sudo apt upgrade -y
```

### **2. Install Dependencies**
```bash
# Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18

# FFmpeg
sudo apt install -y ffmpeg
```

### **3. Setup Project**
```bash
git clone https://github.com/yourusername/video-encoding.git
cd video-encoding
npm install

# Create temp directory
sudo mkdir -p /tmp/video-processing
sudo chmod 755 /tmp/video-processing
sudo chown ubuntu:ubuntu /tmp/video-processing
```

### **4. Configure & Start**
```bash
# Edit .env file
nano .env

# Start server
npm start
```

### **5. Test**
```bash
# Health check
curl http://localhost:3000/health

# Upload video
curl -X POST http://your-ec2-ip:3000/api/upload/video \
  -H "Content-Type: multipart/form-data" \
  -F "video=@/path/to/video.mp4;type=video/mp4"
```

## **Troubleshooting Ubuntu-Specific Issues:**

### **FFmpeg Not Found**
```bash
which ffmpeg
sudo apt update && sudo apt install -y ffmpeg
```

### **Permission Issues**
```bash
sudo chown ubuntu:ubuntu /tmp/video-processing
sudo chmod 755 /tmp/video-processing
```

### **Node.js Issues**
```bash
nvm use 18
node --version
npm --version
```

## **Ready to Deploy! 🚀**

Your video processing service is now configured for Ubuntu EC2 and ready for deployment! 