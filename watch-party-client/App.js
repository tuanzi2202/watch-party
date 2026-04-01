import React, { useRef, useEffect, useState } from 'react';
import { 
  View, Text, StyleSheet, StatusBar, TouchableOpacity, 
  TextInput, Animated, KeyboardAvoidingView, Platform, Keyboard, Alert 
} from 'react-native';
import { WebView } from 'react-native-webview';
import io from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

  useEffect(() => {
    const loadSavedIp = async () => {
      try {
        const savedIp = await AsyncStorage.getItem('watchPartyServerIp');
        if (savedIp) setServerIp(savedIp);
      } catch (e) {
        console.log('读取 IP 失败', e);
      }
    };
    loadSavedIp();

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

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
      setIsConnected(true); 
      console.log('【探针-APP链路】Socket连接成功');
    });
    
    socket.on('disconnect', () => setSyncStatus('已断开连接 🔴'));
    
    // 收到远端同步数据，调用 WebView 内部暴露的 executeRemoteSync 函数
    socket.on('sync_receive', (data) => {
      console.log(`【探针-APP接收】收到服务端下发的进度数据: time=${data.time}, state=${data.state}`);
      if (!webviewRef.current) return;
      const injectScript = `
        if(window.executeRemoteSync) {
          window.executeRemoteSync(${data.time}, '${data.state}');
        }
        true;
      `;
      webviewRef.current.injectJavaScript(injectScript);
    });

    socket.on('change_video', (data) => {
      console.log('【探针-APP接收】收到远端换片请求:', data.bvid);
      setVideoBvid(data.bvid);
    });
  
    // 接收远端弹幕，并直接注入 JavaScript 在网页内部渲染
    socket.on('receive_danmaku', (data) => {
      console.log('【探针-APP接收】渲染弹幕:', data.text);
      if (!webviewRef.current) return;
      
      // 动态在网页内部创建一个画板，生成动画弹幕并定时销毁
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
  };

  // 换片处理函数
  const handleVideoChange = () => {
    const bvid = inputBvid.trim();
    if (bvid) {
      setVideoBvid(bvid); // 改变本地播放器
      if (socketRef.current) {
        socketRef.current.emit('change_video', { bvid: bvid });
        console.log('【探针-APP发出】向服务器发出换片广播:', bvid);
      }
    }
  };

  // 注入到 WebView 网页内部的 JavaScript (新增互斥锁与时间差判断)
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
        var currentState = video.paused ? 'paused' : 'playing';
        var timeDiff = currentTime - lastTime;
        var isSeeking = (Math.abs(timeDiff) > 2 && currentState === 'playing') || (Math.abs(timeDiff) > 0.5 && currentState === 'paused');
        var isStateChanged = currentState !== lastState;

        if (isSeeking || isStateChanged) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'SYNC_ACTION', time: currentTime, state: currentState }));
        }
        lastTime = currentTime; lastState = currentState;
      }
    }, 500);

    // ⚠️ 核心提权与拦截机制
    var tapTimer = null;
    var lastTap = 0;
    
    window.addEventListener('click', function(e) {
      // 坐标防线：放过屏幕底部 90px 的原生进度条和全屏按钮区域，不予拦截
      if (e.clientY > window.innerHeight - 90) return; 

      // 绝对熔断：切断事件向下传播，B 站原生框架将彻底变成“瞎子”收不到本次点击
      e.stopPropagation(); 
      
      var now = Date.now();
      if (now - lastTap < 300) {
        // 双击：触发原生的播放/暂停逻辑
        clearTimeout(tapTimer);
        var video = document.querySelector('video');
        if (video) { video.paused ? video.play() : video.pause(); }
      } else {
        // 单击：延迟 300ms 确认不是双击后，唤出我们自定义的 UI
        tapTimer = setTimeout(function() {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'TOGGLE_UI' }));
        }, 300);
      }
      lastTap = now;
    }, true); // ⚠️ 注意这个 true：代表在事件向下传递的“捕获阶段”就提前半路打劫
    
    true;
  `;

  // 统一拦截 WebView 传回的消息
  const onMessage = (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'LOG') {
        // 在 React Native 控制台打印 WebView 里的探针日志
        console.log(msg.msg); 
      } else if (msg.type === 'SYNC_ACTION' && socketRef.current) {
        console.log('【探针-APP发出】向服务器发出 sync_send:', msg.time);
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

  const seekVideo = (offsetSeconds) => {
    if (!webviewRef.current) return;
    // 直接向 B 站页面空投绝对命令，强制修改当前时间
    const injectSeekScript = `
      var video = document.querySelector('video');
      if (video) {
        var newTime = Math.max(0, video.currentTime + (${offsetSeconds}));
        video.currentTime = newTime;
        // 触发手动修改后，之前的轮询监控会自动捕获这个跃变，并向 PC 端发出同步广播！
      }
      true;
    `;
    webviewRef.current.injectJavaScript(injectSeekScript);
  };

  const sendDanmaku = () => {
    if (chatInput.trim() && socketRef.current) {
      socketRef.current.emit('send_chat', { text: chatInput });
      setChatInput('');
      Keyboard.dismiss();
    }
  };

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
            <TouchableOpacity style={styles.actionBtn} onPress={handleVideoChange}>
              <Text style={styles.btnText}>换片</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ⚠️ 新增：居中的原生快进快退交互面板 */}
        <View style={styles.centerSection} pointerEvents="box-none">
          <TouchableOpacity style={styles.seekCircleBtn} onPress={() => seekVideo(-15)}>
            <Text style={styles.seekBtnIcon}>⏪</Text>
            <Text style={styles.seekBtnText}>15s</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.seekCircleBtn} onPress={() => seekVideo(15)}>
            <Text style={styles.seekBtnIcon}>⏩</Text>
            <Text style={styles.seekBtnText}>15s</Text>
          </TouchableOpacity>
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
  bottomSection: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  roomTitle: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
  statusBadge: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 15 },
  statusText: { color: '#FFF', fontSize: 12, fontWeight: 'bold' },
  input: { flex: 1, backgroundColor: 'rgba(255,255,255,0.2)', color: '#FFF', height: 40, borderRadius: 20, paddingHorizontal: 15, marginRight: 10 },
  actionBtn: { backgroundColor: '#fb7299', height: 40, justifyContent: 'center', paddingHorizontal: 15, borderRadius: 20 },
  btnText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },

  // 在 styles 中追加以下内容
  centerSection: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
  },
  seekCircleBtn: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
  },
  seekBtnIcon: {
    fontSize: 22,
    color: '#FFF',
    marginBottom: 2,
  },
  seekBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
});