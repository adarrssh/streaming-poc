#!/bin/bash

# EC2 Setup Script for Video Processing Service (Ubuntu)
# Run this script on your EC2 Ubuntu instance after cloning the repository

echo "=== Setting up EC2 Ubuntu for Video Processing ==="

# Update system packages
echo "Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js and npm (if not already installed)
echo "Installing Node.js..."
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18

# Install FFmpeg
echo "Installing FFmpeg..."
sudo apt install -y ffmpeg

# Verify FFmpeg installation
echo "Verifying FFmpeg installation..."
ffmpeg -version

# Install project dependencies
echo "Installing Node.js dependencies..."
npm install

# Create temp directory with proper permissions
echo "Setting up temp directory..."
sudo mkdir -p /tmp/video-processing
sudo chmod 755 /tmp/video-processing
sudo chown ubuntu:ubuntu /tmp/video-processing

# Set up environment variables (you'll need to edit this)
echo "Setting up environment variables..."
if [ ! -f .env ]; then
    echo "Creating .env file..."
    cat > .env << EOF
# AWS Configuration
AWS_REGION=your-region
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_S3_BUCKET=your-bucket-name

# Server Configuration
PORT=3000
NODE_ENV=production
EOF
    echo "Please edit .env file with your actual AWS credentials and configuration"
fi

echo "=== EC2 Ubuntu Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Edit .env file with your AWS credentials"
echo "2. Configure S3 bucket for public read access"
echo "3. Start the server: npm start"
echo "4. Test the API endpoints" 