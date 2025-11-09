const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// تخزين الأجهزة المتصلة
const connectedDevices = new Map();
const activeConnections = new Map();

// API للحصول على قائمة الأجهزة
app.get('/api/devices', (req, res) => {
  const devices = Array.from(connectedDevices.values()).map(device => ({
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    publicIp: device.publicIp,
    isOnline: true,
    connectionTime: device.connectionTime,
    hasTunnel: device.hasTunnel || false
  }));
  
  res.json({ success: true, devices });
});

// WebSocket connections
io.on('connection', (socket) => {
  console.log('🔗 جهاز متصل:', socket.id);

  // تسجيل الجهاز
  socket.on('register-device', (deviceData) => {
    const deviceInfo = {
      socketId: socket.id,
      deviceId: deviceData.deviceId,
      deviceName: deviceData.deviceName,
      publicIp: socket.handshake.address,
      connectionTime: new Date().toISOString(),
      hasTunnel: true
    };

    connectedDevices.set(deviceInfo.deviceId, deviceInfo);
    
    // إنشاء نفق افتراضي للجهاز
    const tunnelId = uuidv4();
    deviceInfo.tunnelId = tunnelId;
    
    // إعلام الجهاز بالنفق
    socket.emit('tunnel-created', {
      tunnelId: tunnelId,
      publicUrl: `finixdesk://${tunnelId}.render.com`
    });

    // إعلام جميع الأجهزة بالتحديث
    io.emit('devices-updated', {
      devices: Array.from(connectedDevices.values())
    });

    console.log(`✅ تم تسجيل الجهاز: ${deviceInfo.deviceName} - Tunnel: ${tunnelId}`);
  });

  // طلب اتصال بين جهازين
  socket.on('request-connection', (data) => {
    const targetDevice = connectedDevices.get(data.targetDeviceId);
    
    if (targetDevice) {
      // إرسال طلب اتصال للجهاز الهدف
      io.to(targetDevice.socketId).emit('incoming-connection', {
        fromDeviceId: data.fromDeviceId,
        fromDeviceName: data.fromDeviceName,
        tunnelId: targetDevice.tunnelId
      });
      
      console.log(`📩 إرسال طلب اتصال من ${data.fromDeviceName} إلى ${targetDevice.deviceName}`);
    }
  });

  // قبول الاتصال
  socket.on('accept-connection', (data) => {
    const fromDevice = connectedDevices.get(data.fromDeviceId);
    
    if (fromDevice) {
      // إعلام الجهاز الطالب بأن الاتصال مقبول
      io.to(fromDevice.socketId).emit('connection-accepted', {
        targetDeviceId: data.targetDeviceId,
        targetDeviceName: data.targetDeviceName,
        tunnelUrl: `rdp://${data.targetDeviceId}.finixdesk.com:3389`
      });
      
      console.log(`✅ تم قبول الاتصال بين ${data.targetDeviceName} و ${fromDevice.deviceName}`);
    }
  });

  // رفض الاتصال
  socket.on('reject-connection', (data) => {
    const fromDevice = connectedDevices.get(data.fromDeviceId);
    
    if (fromDevice) {
      io.to(fromDevice.socketId).emit('connection-rejected', {
        targetDeviceName: data.targetDeviceName
      });
    }
  });

  // إشارات WebRTC للبيانات
  socket.on('relay-signal', (data) => {
    const targetDevice = connectedDevices.get(data.targetDeviceId);
    
    if (targetDevice) {
      io.to(targetDevice.socketId).emit('relay-signal', {
        fromDeviceId: data.fromDeviceId,
        signal: data.signal
      });
    }
  });

  socket.on('disconnect', () => {
    // إزالة الجهاز عند انقطاع الاتصال
    for (let [deviceId, device] of connectedDevices) {
      if (device.socketId === socket.id) {
        connectedDevices.delete(deviceId);
        io.emit('devices-updated', {
          devices: Array.from(connectedDevices.values())
        });
        console.log(`❌ انقطع الجهاز: ${device.deviceName}`);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 FinixDesk Tunnel Server running on port ${PORT}`);
  console.log(`🌍 Server URL: https://your-app.onrender.com`);
});
