import React, { useRef, useEffect, useState } from 'react';
import { 
  View, Text, StyleSheet, StatusBar, TouchableOpacity, 
  TextInput, Animated, KeyboardAvoidingView, Platform, Keyboard, Alert 
} from 'react-native';
import { WebView } from 'react-native-webview';
import io from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';

// 时间格式化辅助函数 (将秒数转为 mm:ss)
const formatTime = (seconds) => {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
};

export default function WatchPartyApp() {
  const [serverIp, setServerIp] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef(null); 
  
  const webviewRef = useRef(null);
  const [syncStatus, setSyncStatus] = useState('连接中...');
  const [videoBvid, setVideoBvid] = useState('BV1LSXDBiEGG');
  const [inputBvid, setInputBvid] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [uiVisible, setUiVisible] = useState(true);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // ⚠️ 新增：原生进度条所需的视频状态管理
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const isSliding = useRef(false); // 拖拽互斥锁（使用 ref 避免引发组件不必要的重渲染）

  useEffect(() => {
    const loadSavedIp = async () => {
      try {
        const savedIp = await AsyncStorage.getItem('watchPartyServerIp');
        if (savedIp) setServerIp(savedIp);
      } catch (e) {}
    };
    loadSavedIp();

    return () => { if (socketRef.current) socketRef.current.disconnect(); };
  }, []);

  const connectToServer = async () => {
    if (!serverIp.trim()) return Alert.alert('提示', '请输入服务器 IP');
    await AsyncStorage.setItem('watchPartyServerIp', serverIp.trim());
    
    let url = serverIp.trim();
    if (!url.startsWith('ws://') && !url.startsWith('http://')) url = 'ws://' + url;

    if (socketRef.current) socketRef.current.disconnect();

    const socket = io(url, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSyncStatus('已连接好友 🟢');
      setIsConnected(true); 
    });
    
    socket.on('disconnect', () => setSyncStatus('已断开连接 🔴'));
    
    // 接收远端弹幕
    socket.on('receive_danmaku', (data) => {
      if (!webviewRef.current) return;
      const injectDanmakuScript = `
        (function() {
          var container = document.getElementById('custom-rn-danmaku');
          if(!container) {
              container = document.createElement('div');
              container.id = 'custom-rn-danmaku';
              container.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:999999;overflow:hidden;';
              document.body.appendChild(container);
              var style = document.createElement('style');
              style.innerHTML = '@keyframes danmakuRN { from { transform: translateX(100vw); } to { transform: translateX(-100%); } }';
              document.head.appendChild(style);
          }
          var el = document.createElement('div');
          el.innerText = '${data.text}';
          el.style.cssText = 'position:absolute;white-space:nowrap;color:#fff;font-size:20px;font-weight:bold;text-shadow:1px 1px 2px #000;animation:danmakuRN 5s linear forwards;top:' + (Math.random()*50+10) + '%;';
          container.appendChild(el);
          setTimeout(function() { el.remove(); }, 5000);
        })();
        true;
      `;
      webviewRef.current.injectJavaScript(injectDanmakuScript);
    });

    socket.on('sync_receive', (data) => {
      if (!webviewRef.current) return;
      const injectScript = `
        if(window.executeRemoteSync) {
          window.executeRemoteSync(${data.time}, '${data.state}');
        }
        true;
      `;
      webviewRef.current.injectJavaScript(injectScript);
    });

    socket.on('change_video', (data) => { setVideoBvid(data.bvid); });
  };

  const injectedMonitorScript = `
    var isRemoteSyncing = false;
    var lastTime = 0;
    var lastState = 'paused';

    window.executeRemoteSync = function(time, state) {
       isRemoteSyncing = true;
       var video = document.querySelector('video');
       if (video) {
         if (Math.abs(video.currentTime - time) > 1.5) video.currentTime = time;
         if (state === 'playing' && video.paused) video.play().catch(function(e){});
         else if (state === 'paused' && !video.paused) video.pause();
       }
       setTimeout(function(){ isRemoteSyncing = false; }, 1000);
    };

    setInterval(function() {
      if(isRemoteSyncing) return;
      var video = document.querySelector('video');
      if (video) {
        var currentTime = video.currentTime;
        var duration = video.duration || 0;
        var currentState = video.paused ? 'paused' : 'playing';
        
        // ⚠️ 新增：高频向 RN 发送纯粹的进度更新（用于渲染 Slider）
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'PROGRESS_UPDATE',
          time: currentTime,
          duration: duration
        }));

        var timeDiff = currentTime - lastTime;
        var isSeeking = (Math.abs(timeDiff) > 2 && currentState === 'playing') || (Math.abs(timeDiff) > 0.5 && currentState === 'paused');
        var isStateChanged = currentState !== lastState;

        if (isSeeking || isStateChanged) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'SYNC_ACTION', time: currentTime, state: currentState }));
        }
        lastTime = currentTime; lastState = currentState;
      }
    }, 500);

    var tapTimer = null;
    var lastTap = 0;
    window.addEventListener('click', function(e) {
      if (e.clientY > window.innerHeight - 90) return; 
      e.stopPropagation(); 
      var now = Date.now();
      if (now - lastTap < 300) {
        clearTimeout(tapTimer);
        var video = document.querySelector('video');
        if (video) { video.paused ? video.play() : video.pause(); }
      } else {
        tapTimer = setTimeout(function() {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'TOGGLE_UI' }));
        }, 300);
      }
      lastTap = now;
    }, true); 
    true;
  `;

  const onMessage = (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'PROGRESS_UPDATE') {
        // ⚠️ 核心锁机制：只有在用户手指没有按在 Slider 上时，才允许底层时间更新 UI
        if (!isSliding.current) {
          setCurrentTime(msg.time);
          setDuration(msg.duration);
        }
      } else if (msg.type === 'SYNC_ACTION' && socketRef.current) {
        socketRef.current.emit('sync_send', { time: msg.time, state: msg.state });
      } else if (msg.type === 'TOGGLE_UI') {
        toggleUI();
      }
    } catch (e) {}
  };

  // ⚠️ 新增：处理原生 Slider 拖动事件
  const handleSlidingStart = () => {
    isSliding.current = true; // 上锁：屏蔽 WebView 的进度汇报
  };

  const handleSlidingComplete = (value) => {
    // 1. 将时间强制注入回 WebView
    if (webviewRef.current) {
      webviewRef.current.injectJavaScript(`
        var video = document.querySelector('video');
        if (video) { video.currentTime = ${value}; }
        true;
      `);
    }
    // 2. 向全网广播这一次原生拖拽跳转
    if (socketRef.current) {
      socketRef.current.emit('sync_send', { time: value, state: 'playing' });
    }
    
    setCurrentTime(value);
    // 延迟 500ms 解锁，给网络和底层 DOM 反应时间，防止进度条回弹闪烁
    setTimeout(() => { isSliding.current = false; }, 500);
  };

  const toggleUI = () => {
    const toValue = uiVisible ? 0 : 1;
    Animated.timing(fadeAnim, { toValue, duration: 250, useNativeDriver: true }).start();
    setUiVisible(!uiVisible);
    Keyboard.dismiss();
  };

  const sendDanmaku = () => {
    if (chatInput.trim() && socketRef.current) {
      socketRef.current.emit('send_chat', { text: chatInput });
      setChatInput('');
      Keyboard.dismiss();
    }
  };

  const handleVideoChange = () => {
    const bvid = inputBvid.trim();
    if (bvid) {
      setVideoBvid(bvid); 
      if (socketRef.current) socketRef.current.emit('change_video', { bvid: bvid });
    }
  };

  if (!isConnected) {
    return (
      <View style={styles.setupContainer}>
        <StatusBar hidden={true} />
        <Text style={styles.setupTitle}>⚙️ 专属放映室配置</Text>
        <TextInput style={styles.setupInput} placeholder="例如: 服务器IP:3000" placeholderTextColor="#888" value={serverIp} onChangeText={setServerIp} keyboardType="url" autoCapitalize="none" />
        <TouchableOpacity style={styles.setupBtn} onPress={connectToServer}>
          <Text style={styles.setupBtnText}>保存并连接</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <StatusBar hidden={true} />
      <View style={styles.videoContainer}>
        <WebView
          ref={webviewRef}
          source={{ uri: `https://player.bilibili.com/player.html?isOutside=true&bvid=${videoBvid}&high_quality=1` }}
          style={styles.webview}
          userAgent="Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36"
          injectedJavaScript={injectedMonitorScript}
          onMessage={onMessage}
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled={true}
          domStorageEnabled={true} 
          originWhitelist={['*']} 
          mixedContentMode="always" 
          allowsInlineMediaPlayback={true} 
        />
      </View>

      <Animated.View style={[styles.uiOverlay, { opacity: fadeAnim }]} pointerEvents={uiVisible ? 'box-none' : 'none'}>
        <View style={styles.topSection} pointerEvents="box-none">
          <View style={styles.statusBar}>
            <Text style={styles.roomTitle}>🎬 专属放映室</Text>
            <View style={styles.statusBadge}><Text style={styles.statusText}>{syncStatus}</Text></View>
          </View>
          <View style={styles.searchBar}>
            <TextInput style={styles.input} placeholder="输入新的 BV号..." placeholderTextColor="#CCC" value={inputBvid} onChangeText={setInputBvid} />
            <TouchableOpacity style={styles.actionBtn} onPress={handleVideoChange}><Text style={styles.btnText}>换片</Text></TouchableOpacity>
          </View>
        </View>

        <View style={styles.bottomSection} pointerEvents="box-none">
          {/* ⚠️ 新增：原生极致丝滑进度轴 */}
          <View style={styles.sliderPanel}>
            <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={duration > 0 ? duration : 1}
              value={currentTime}
              onSlidingStart={handleSlidingStart}
              onSlidingComplete={handleSlidingComplete}
              minimumTrackTintColor="#fb7299"
              maximumTrackTintColor="rgba(255,255,255,0.3)"
              thumbTintColor="#fb7299"
            />
            <Text style={styles.timeText}>{formatTime(duration)}</Text>
          </View>

          <View style={styles.chatPanel}>
            <TextInput style={styles.input} placeholder="发条弹幕互动一下..." placeholderTextColor="#CCC" value={chatInput} onChangeText={setChatInput} onSubmitEditing={sendDanmaku} />
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#00aeec' }]} onPress={sendDanmaku}><Text style={styles.btnText}>发送</Text></TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  setupContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', padding: 20 },
  setupTitle: { color: '#FFF', fontSize: 24, fontWeight: 'bold', marginBottom: 30 },
  setupInput: { width: '100%', backgroundColor: '#222', color: '#FFF', height: 50, borderRadius: 10, paddingHorizontal: 15, fontSize: 16, marginBottom: 20, textAlign: 'center' },
  setupBtn: { backgroundColor: '#fb7299', width: '100%', height: 50, justifyContent: 'center', alignItems: 'center', borderRadius: 10 },
  setupBtnText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  container: { flex: 1, backgroundColor: '#000' },
  videoContainer: { flex: 1 },
  webview: { flex: 1 },
  uiOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between', paddingVertical: 15, paddingHorizontal: 20, backgroundColor: 'rgba(0,0,0,0.3)' },
  topSection: { gap: 10 },
  statusBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center' },
  bottomSection: { gap: 15, width: '100%' },
  
  // ⚠️ 新增：原生进度轴样式
  sliderPanel: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, paddingHorizontal: 15, paddingVertical: 5 },
  timeText: { color: '#FFF', fontSize: 12, fontVariant: ['tabular-nums'], width: 45, textAlign: 'center' },
  slider: { flex: 1, height: 40, marginHorizontal: 5 },
  
  chatPanel: { flexDirection: 'row', alignItems: 'center' },
  roomTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  statusBadge: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 15 },
  statusText: { color: '#FFF', fontSize: 12, fontWeight: 'bold' },
  input: { flex: 1, backgroundColor: 'rgba(255,255,255,0.2)', color: '#FFF', height: 40, borderRadius: 20, paddingHorizontal: 15, marginRight: 10 },
  actionBtn: { backgroundColor: '#fb7299', height: 40, justifyContent: 'center', paddingHorizontal: 15, borderRadius: 20 },
  btnText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },
});