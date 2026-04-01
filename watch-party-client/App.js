import React, { useRef, useEffect, useState } from 'react';
import { 
  View, Text, StyleSheet, StatusBar, TouchableOpacity, 
  TextInput, Animated, KeyboardAvoidingView, Platform, Keyboard, Alert 
} from 'react-native';
import { WebView } from 'react-native-webview';
import io from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function WatchPartyApp() {
  // === 新增：连接状态与 IP 管理 ===
  const [serverIp, setServerIp] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef(null); 
  
  // === 原有状态 ===
  const webviewRef = useRef(null);
  const [syncStatus, setSyncStatus] = useState('连接中...');
  const [videoBvid, setVideoBvid] = useState('BV1LSXDBiEGG');
  const [inputBvid, setInputBvid] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [uiVisible, setUiVisible] = useState(true);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // App 启动时读取本地存储的 IP
  useEffect(() => {
    const loadSavedIp = async () => {
      try {
        const savedIp = await AsyncStorage.getItem('watchPartyServerIp');
        if (savedIp) setServerIp(savedIp);ip
      } catch (e) {
        console.log('读取 IP 失败', e);
      }
    };
    loadSavedIp();

    // 组件卸载时断开连接
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  // 执行连接服务器逻辑
  const connectToServer = async () => {
    if (!serverIp.trim()) return Alert.alert('提示', '请输入服务器 IP');

    await AsyncStorage.setItem('watchPartyServerIp', serverIp.trim());
    
    let url = serverIp.trim();
    if (!url.startsWith('ws://') && !url.startsWith('http://')) {
      url = 'ws://' + url;
    }

    if (socketRef.current) socketRef.current.disconnect();

    const socket = io(url, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSyncStatus('已连接好友 🟢');
      setIsConnected(true); // 连接成功，切入视频界面
    });
    
    socket.on('disconnect', () => setSyncStatus('已断开连接 🔴'));
    
    socket.on('connect_error', () => {
      Alert.alert('连接失败', '请检查 IP 地址和端口是否正确，并确保服务器已开启。');
      socket.disconnect();
    });

    socket.on('sync_receive', (data) => {
      if (!webviewRef.current) return;
      const injectScript = `
        var video = document.querySelector('video');
        if (video) {
          if (Math.abs(video.currentTime - ${data.time}) > 1) {
            video.currentTime = ${data.time};
          }
          if ('${data.state}' === 'playing' && video.paused) {
            video.play();
          } else if ('${data.state}' === 'paused' && !video.paused) {
            video.pause();
          }
        }
        true;
      `;
      webviewRef.current.injectJavaScript(injectScript);
    });
  };

  const injectedMonitorScript = `
    setInterval(function() {
      var video = document.querySelector('video');
      if (video) {
        var state = video.paused ? 'paused' : 'playing';
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'SYNC_ACTION',
          time: video.currentTime,
          state: state
        }));
      }
    }, 1000);

    var tapTimer = null;
    var lastTap = 0;
    window.addEventListener('click', function(e) {
      var now = Date.now();
      if (now - lastTap < 300) {
        clearTimeout(tapTimer);
        var video = document.querySelector('video');
        if (video) {
          video.paused ? video.play() : video.pause();
        }
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
      if (msg.type === 'SYNC_ACTION' && socketRef.current) {
        socketRef.current.emit('sync_send', { time: msg.time, state: msg.state });
      } else if (msg.type === 'TOGGLE_UI') {
        toggleUI();
      }
    } catch (e) {}
  };

  const toggleUI = () => {
    const toValue = uiVisible ? 0 : 1;
    Animated.timing(fadeAnim, {
      toValue,
      duration: 250,
      useNativeDriver: true,
    }).start();
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

  // === 界面 1：配置界面 (未连接时显示) ===
  if (!isConnected) {
    return (
      <View style={styles.setupContainer}>
        <StatusBar hidden={true} />
        <Text style={styles.setupTitle}>⚙️ 专属放映室配置</Text>
        <TextInput
          style={styles.setupInput}
          placeholder="例如: 服务器IP:3000"
          placeholderTextColor="#888"
          value={serverIp}
          onChangeText={setServerIp}
          keyboardType="url"
          autoCapitalize="none"
        />
        <TouchableOpacity style={styles.setupBtn} onPress={connectToServer}>
          <Text style={styles.setupBtnText}>保存并连接</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // === 界面 2：放映室界面 (连接成功后显示) ===
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
          onError={(e) => console.warn('WebView 加载错误:', e.nativeEvent.description)}
        />
      </View>

      <Animated.View style={[styles.uiOverlay, { opacity: fadeAnim }]} pointerEvents={uiVisible ? 'box-none' : 'none'}>
        <View style={styles.topSection}>
          <View style={styles.statusBar}>
            <Text style={styles.roomTitle}>🎬 专属放映室</Text>
            <View style={styles.statusBadge}>
              <Text style={styles.statusText}>{syncStatus}</Text>
            </View>
          </View>
          <View style={styles.searchBar}>
            <TextInput 
              style={styles.input} 
              placeholder="输入新的 BV号..." 
              placeholderTextColor="#CCC" 
              value={inputBvid} 
              onChangeText={setInputBvid} 
            />
            <TouchableOpacity style={styles.actionBtn} onPress={() => { if(inputBvid) setVideoBvid(inputBvid); }}>
              <Text style={styles.btnText}>换片</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.bottomSection}>
          <TextInput 
            style={styles.input} 
            placeholder="发条弹幕互动一下..." 
            placeholderTextColor="#CCC" 
            value={chatInput} 
            onChangeText={setChatInput} 
            onSubmitEditing={sendDanmaku} 
          />
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#00aeec' }]} onPress={sendDanmaku}>
            <Text style={styles.btnText}>发送</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // 配置页面样式
  setupContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', padding: 20 },
  setupTitle: { color: '#FFF', fontSize: 24, fontWeight: 'bold', marginBottom: 30 },
  setupInput: { width: '100%', backgroundColor: '#222', color: '#FFF', height: 50, borderRadius: 10, paddingHorizontal: 15, fontSize: 16, marginBottom: 20, textAlign: 'center' },
  setupBtn: { backgroundColor: '#fb7299', width: '100%', height: 50, justifyContent: 'center', alignItems: 'center', borderRadius: 10 },
  setupBtnText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  
  // 原播放器页面样式
  container: { flex: 1, backgroundColor: '#000' },
  videoContainer: { flex: 1 },
  webview: { flex: 1 },
  uiOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between', paddingVertical: 15, paddingHorizontal: 20, backgroundColor: 'rgba(0,0,0,0.3)' },
  topSection: { gap: 10 },
  statusBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center' },
  bottomSection: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  roomTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  statusBadge: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 15 },
  statusText: { color: '#FFF', fontSize: 12, fontWeight: 'bold' },
  input: { flex: 1, backgroundColor: 'rgba(255,255,255,0.2)', color: '#FFF', height: 40, borderRadius: 20, paddingHorizontal: 15, marginRight: 10 },
  actionBtn: { backgroundColor: '#fb7299', height: 40, justifyContent: 'center', paddingHorizontal: 15, borderRadius: 20 },
  btnText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },
});