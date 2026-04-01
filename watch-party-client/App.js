import React, { useRef, useEffect, useState } from 'react';
import { 
  View, Text, StyleSheet, StatusBar, TouchableOpacity, 
  TextInput, Animated, KeyboardAvoidingView, Platform, Keyboard, Alert, Dimensions
} from 'react-native';
import { WebView } from 'react-native-webview';
import io from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';

// ⚠️ 新增：静态盲盒数据池 (可自行扩充高质量 BVID)
const RANDOM_BVID_POOL = [
  'BV1LSXDBiEGG', // 默认高画质风景
  'BV1GJ411x7h7', // 经典爆款
  'BV1xx411c7mD', // 热门动画
  'BV17x411w7KC', // 知识科普
  'BV1qM4y1w716', // 音乐 MV
  'BV1aA4y1I7vL', // 鬼畜经典
  'BV1Q54y1y7eA'  // 游戏混剪
];

const formatTime = (seconds) => {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
};

// ==========================================
// 🎮 视界 1: PSV 风格主菜单组件
// ==========================================
const PSVMenuScreen = ({ onNavigate }) => {
  const breathAnim = useRef(new Animated.Value(1)).current;
  
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(breathAnim, { toValue: 1.08, duration: 4000, useNativeDriver: true }),
        Animated.timing(breathAnim, { toValue: 1, duration: 4000, useNativeDriver: true })
      ])
    ).start();
  }, []);

  const renderBubble = (icon, title, color, action) => (
    <TouchableOpacity style={styles.bubbleContainer} onPress={action} activeOpacity={0.6}>
      <View style={[styles.bubble, { backgroundColor: color }]}>
        <Ionicons name={icon} size={42} color="#FFF" />
      </View>
      <Text style={styles.bubbleText}>{title}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.menuRoot}>
      <StatusBar hidden={true} />
      <Animated.View style={[styles.bgWave1, { transform: [{ scale: breathAnim }] }]} />
      <Animated.View style={[styles.bgWave2, { transform: [{ scale: breathAnim }] }]} />

      <View style={styles.menuHeader}>
        <Text style={styles.menuTime}>10:04 AM</Text>
        <View style={styles.menuIcons}>
          <Ionicons name="wifi" size={18} color="#FFF" style={{marginRight: 8}}/>
          <Ionicons name="battery-full" size={18} color="#FFF" />
        </View>
      </View>

      <View style={styles.bubbleGrid}>
        {renderBubble('videocam', '专属放映室', 'rgba(251, 114, 153, 0.7)', () => onNavigate('watch_party', { autoRandom: false }))}
        {/* ⚠️ 新增：随机盲盒菜单项 */}
        {renderBubble('shuffle', '随机盲盒', 'rgba(255, 165, 0, 0.7)', () => onNavigate('watch_party', { autoRandom: true }))}
        {renderBubble('game-controller', '开源游戏库', 'rgba(0, 200, 255, 0.7)', () => Alert.alert('提示', '开源游戏索引模块开发中...'))}
        {renderBubble('book', 'JoJo 设定集', 'rgba(150, 50, 255, 0.7)', () => Alert.alert('提示', 'JoJo 宇宙图鉴整理中...'))}
      </View>
    </View>
  );
};

// ==========================================
// 🎬 视界 2: 放映室应用组件
// ==========================================
const WatchPartyScreen = ({ onBack, routeParams }) => {
  const [serverIp, setServerIp] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef(null); 
  const [roomId, setRoomId] = useState('');
  
  const webviewRef = useRef(null);
  const [syncStatus, setSyncStatus] = useState('连接中...');
  
  // ⚠️ 新增：如果入口是随机盲盒，初始化时就随机抽取一个 ID
  const initialBvid = routeParams?.autoRandom 
    ? RANDOM_BVID_POOL[Math.floor(Math.random() * RANDOM_BVID_POOL.length)] 
    : 'BV1LSXDBiEGG';
  const [videoBvid, setVideoBvid] = useState(initialBvid);
  
  const [inputBvid, setInputBvid] = useState('');
  const [chatInput, setChatInput] = useState('');
  
  const [uiVisible, setUiVisible] = useState(true);
  const uiVisibleRef = useRef(true); 
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false); 
  
  const isSliding = useRef(false); 
  const hideTimerRef = useRef(null);

  useEffect(() => {
    const loadSavedData = async () => {
      try {
        const savedIp = await AsyncStorage.getItem('watchPartyServerIp');
        const savedRoom = await AsyncStorage.getItem('watchPartyRoomId');
        if (savedIp) setServerIp(savedIp);
        if (savedRoom) setRoomId(savedRoom);
      } catch (e) {}
    };
    loadSavedData();
    return () => { if (socketRef.current) socketRef.current.disconnect(); clearHideTimer(); };
  }, []);

  const clearHideTimer = () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  const startHideTimer = () => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => { if (uiVisibleRef.current) forceHideUI(); }, 4000);
  };

  const forceHideUI = () => {
    if (!uiVisibleRef.current) return;
    Animated.timing(fadeAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start();
    setUiVisible(false); uiVisibleRef.current = false; Keyboard.dismiss();
  };

  const forceShowUI = () => {
    if (uiVisibleRef.current) return;
    Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    setUiVisible(true); uiVisibleRef.current = true; startHideTimer(); 
  };

  const toggleUI = () => { uiVisibleRef.current ? forceHideUI() : forceShowUI(); };

  const connectToServer = async () => {
    if (!serverIp.trim()) return Alert.alert('提示', '请输入服务器 IP');
    const targetRoom = roomId.trim() || 'public_hall';
    
    await AsyncStorage.setItem('watchPartyServerIp', serverIp.trim());
    await AsyncStorage.setItem('watchPartyRoomId', targetRoom);
    
    let url = serverIp.trim();
    if (!url.startsWith('ws://') && !url.startsWith('http://')) url = 'ws://' + url;

    if (socketRef.current) socketRef.current.disconnect();

    const socket = io(url, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => { 
      // ⚠️ 核心新增：连接成功后立刻加入对应房间
      socket.emit('join_room', targetRoom);
      
      setSyncStatus(`已加入包厢: ${targetRoom} 🟢`); 
      setIsConnected(true); 
      startHideTimer(); 
      if (routeParams?.autoRandom) {
        socket.emit('change_video', { bvid: initialBvid });
      }
    });
    
    socket.on('disconnect', () => setSyncStatus('已断开连接 🔴'));
    
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
      webviewRef.current.injectJavaScript(`if(window.executeRemoteSync) { window.executeRemoteSync(${data.time}, '${data.state}'); } true;`);
    });

    socket.on('change_video', (data) => { setVideoBvid(data.bvid); });
  };

  const injectedMonitorScript = `
    setInterval(function() {
      var video = document.querySelector('video');
      if (video && video.style.position !== 'fixed') {
        video.style.cssText = 'position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 9998 !important; object-fit: contain !important; background: #000 !important; margin: 0 !important; padding: 0 !important; pointer-events: none !important;';
      }
    }, 500);

    var isRemoteSyncing = false;
    var lastTime = 0; var lastState = 'paused';

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
        
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'PROGRESS_UPDATE', time: currentTime, duration: duration, state: currentState }));

        var timeDiff = currentTime - lastTime;
        var isSeeking = (Math.abs(timeDiff) > 2 && currentState === 'playing') || (Math.abs(timeDiff) > 0.5 && currentState === 'paused');
        var isStateChanged = currentState !== lastState;

        if (isSeeking || isStateChanged) { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'SYNC_ACTION', time: currentTime, state: currentState })); }
        lastTime = currentTime; lastState = currentState;
      }
    }, 500);

    var tapTimer = null; var lastTap = 0;
    window.addEventListener('click', function(e) {
      if (e.clientY > window.innerHeight - 90) return; 
      e.stopPropagation(); 
      var now = Date.now();
      if (now - lastTap < 300) {
        clearTimeout(tapTimer);
        var video = document.querySelector('video');
        if (video) { video.paused ? video.play() : video.pause(); }
      } else {
        tapTimer = setTimeout(function() { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'TOGGLE_UI' })); }, 300);
      }
      lastTap = now;
    }, true); 
    true;
  `;

  const onMessage = (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'PROGRESS_UPDATE') {
        if (!isSliding.current) { setCurrentTime(msg.time); setDuration(msg.duration); setIsPlaying(msg.state === 'playing'); }
      } else if (msg.type === 'SYNC_ACTION' && socketRef.current) {
        socketRef.current.emit('sync_send', { time: msg.time, state: msg.state });
      } else if (msg.type === 'TOGGLE_UI') { toggleUI(); }
    } catch (e) {}
  };

  const togglePlayPause = () => {
    const nextState = !isPlaying; setIsPlaying(nextState); startHideTimer(); 
    if (webviewRef.current) webviewRef.current.injectJavaScript(`var video = document.querySelector('video'); if (video) { ${nextState ? 'video.play()' : 'video.pause()'}; } true;`);
    if (socketRef.current) socketRef.current.emit('sync_send', { time: currentTime, state: nextState ? 'playing' : 'paused' });
  };

  const handleSlidingStart = () => { isSliding.current = true; clearHideTimer(); };
  const handleSlidingComplete = (value) => {
    startHideTimer(); 
    if (webviewRef.current) webviewRef.current.injectJavaScript(`var video = document.querySelector('video'); if (video) { video.currentTime = ${value}; } true;`);
    if (socketRef.current) socketRef.current.emit('sync_send', { time: value, state: 'playing' });
    setCurrentTime(value);
    setTimeout(() => { isSliding.current = false; }, 500);
  };

  const sendDanmaku = () => {
    if (chatInput.trim() && socketRef.current) {
      socketRef.current.emit('send_chat', { text: chatInput });
      setChatInput(''); Keyboard.dismiss();
    }
  };

  const handleVideoChange = () => {
    const bvid = inputBvid.trim();
    if (bvid && socketRef.current) { setVideoBvid(bvid); socketRef.current.emit('change_video', { bvid: bvid }); }
  };

  // ⚠️ 新增：随机换片功能（模拟刷视频）
  const playRandomVideo = () => {
    startHideTimer();
    const randomId = RANDOM_BVID_POOL[Math.floor(Math.random() * RANDOM_BVID_POOL.length)];
    setVideoBvid(randomId);
    if (socketRef.current) socketRef.current.emit('change_video', { bvid: randomId });
  };

  if (!isConnected) {
    return (
      <View style={styles.setupContainer}>
        <StatusBar hidden={true} />
        <TouchableOpacity style={styles.backBtnWrapper} onPress={onBack}>
          <Ionicons name="arrow-back" size={28} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.setupTitle}>⚙️ {routeParams?.autoRandom ? '准备开启盲盒' : '专属放映室配置'}</Text>
        <TextInput style={styles.setupInput} placeholder="例如: 服务器IP:3000" placeholderTextColor="#888" value={serverIp} onChangeText={setServerIp} keyboardType="url" autoCapitalize="none" />
        <TextInput 
          style={[styles.setupInput, {marginTop: -5}]} 
          placeholder="请输入房间口令 (如: 520)" 
          placeholderTextColor="#888" 
          value={roomId} 
          onChangeText={setRoomId} 
          autoCapitalize="none" 
        />
        <TouchableOpacity style={styles.setupBtn} onPress={connectToServer}>
          <Text style={styles.setupBtnText}>启动链路</Text>
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
          mediaPlaybackRequiresUserAction={false} javaScriptEnabled={true} domStorageEnabled={true} originWhitelist={['*']} mixedContentMode="always" allowsInlineMediaPlayback={true} 
        />
      </View>

      <Animated.View style={[styles.uiOverlay, { opacity: fadeAnim }]} pointerEvents={uiVisible ? 'box-none' : 'none'}>
        <View style={styles.topSection} pointerEvents="box-none">
          <View style={styles.statusBar}>
            <View style={{flexDirection:'row', alignItems:'center'}}>
              <TouchableOpacity onPress={onBack} style={{marginRight: 10}}>
                <Ionicons name="close-circle" size={26} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>
              <Text style={styles.roomTitle}>🎬 放映室频道</Text>
            </View>
            <View style={styles.statusBadge}><Text style={styles.statusText}>{syncStatus}</Text></View>
          </View>
          <View style={styles.searchBar}>
            {/* ⚠️ 核心隔离：如果不是盲盒模式，才显示 BV 号输入框和手动换片 */}
            {!routeParams?.autoRandom ? (
              <>
                <TextInput style={styles.input} placeholder="输入新的 BV号..." placeholderTextColor="#CCC" value={inputBvid} onChangeText={setInputBvid} onFocus={clearHideTimer} onBlur={startHideTimer} />
                <TouchableOpacity style={styles.actionBtn} onPress={handleVideoChange}>
                  <Text style={styles.btnText}>换片</Text>
                </TouchableOpacity>
              </>
            ) : (
              /* ⚠️ 核心隔离：如果是盲盒模式，只显示一个宽大醒目的随机抽卡按钮 */
              <TouchableOpacity style={[styles.actionBtn, {backgroundColor: '#ff9800', flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center'}]} onPress={playRandomVideo}>
                <Ionicons name="dice" size={20} color="#FFF" style={{marginRight: 8}} />
                <Text style={styles.btnText}>换个盲盒视频</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={styles.bottomSection} pointerEvents="box-none">
          <View style={styles.sliderPanel}>
            <TouchableOpacity onPress={togglePlayPause} style={styles.playPauseBtn}>
              <Ionicons name={isPlaying ? "pause" : "play"} size={22} color="#FFF" style={{ marginLeft: isPlaying ? 0 : 3 }} />
            </TouchableOpacity>
            <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
            <Slider style={styles.slider} minimumValue={0} maximumValue={duration > 0 ? duration : 1} value={currentTime} onSlidingStart={handleSlidingStart} onSlidingComplete={handleSlidingComplete} minimumTrackTintColor="#fb7299" maximumTrackTintColor="rgba(255,255,255,0.3)" thumbTintColor="#fb7299" />
            <Text style={styles.timeText}>{formatTime(duration)}</Text>
          </View>
          <View style={styles.chatPanel}>
            <TextInput style={styles.input} placeholder="发条弹幕互动一下..." placeholderTextColor="#CCC" value={chatInput} onChangeText={setChatInput} onSubmitEditing={sendDanmaku} onFocus={clearHideTimer} onBlur={startHideTimer} />
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#00aeec' }]} onPress={sendDanmaku}><Text style={styles.btnText}>发送</Text></TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
  );
};

// ==========================================
// 🚀 根容器
// ==========================================
export default function App() {
  const [currentRoute, setCurrentRoute] = useState('menu');
  const [routeParams, setRouteParams] = useState(null);

  if (currentRoute === 'menu') {
    return <PSVMenuScreen onNavigate={(route, params) => { setCurrentRoute(route); setRouteParams(params); }} />;
  }
  return <WatchPartyScreen routeParams={routeParams} onBack={() => { setCurrentRoute('menu'); setRouteParams(null); }} />;
}

const styles = StyleSheet.create({
  menuRoot: { flex: 1, backgroundColor: '#0a0a1a', justifyContent: 'center', alignItems: 'center' },
  bgWave1: { position: 'absolute', width: 800, height: 800, borderRadius: 400, backgroundColor: 'rgba(0, 150, 255, 0.15)', top: -200, left: -200 },
  bgWave2: { position: 'absolute', width: 600, height: 600, borderRadius: 300, backgroundColor: 'rgba(150, 0, 255, 0.1)', bottom: -150, right: -150 },
  menuHeader: { position: 'absolute', top: 20, width: '100%', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 30 },
  menuTime: { color: '#FFF', fontSize: 16, fontWeight: 'bold', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: {width: 1, height: 1}, textShadowRadius: 3 },
  menuIcons: { flexDirection: 'row', alignItems: 'center' },
  bubbleGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', width: '80%', marginTop: 20, gap: 40 },
  bubbleContainer: { alignItems: 'center', width: 100 },
  bubble: { width: 76, height: 76, borderRadius: 38, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)', shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 10 },
  bubbleText: { color: '#FFF', marginTop: 10, fontSize: 13, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: {width: 0, height: 1}, textShadowRadius: 2 },

  backBtnWrapper: { position: 'absolute', top: 30, left: 30, zIndex: 10, padding: 10 },
  setupContainer: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', padding: 20 },
  setupTitle: { color: '#FFF', fontSize: 24, fontWeight: 'bold', marginBottom: 30 },
  setupInput: { width: '80%', maxWidth: 400, backgroundColor: '#222', color: '#FFF', height: 50, borderRadius: 10, paddingHorizontal: 15, fontSize: 16, marginBottom: 20, textAlign: 'center' },
  setupBtn: { backgroundColor: '#fb7299', width: '80%', maxWidth: 400, height: 50, justifyContent: 'center', alignItems: 'center', borderRadius: 10 },
  setupBtnText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  container: { flex: 1, backgroundColor: '#000' },
  videoContainer: { flex: 1 },
  webview: { flex: 1 },
  uiOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between', paddingVertical: 15, paddingHorizontal: 20, backgroundColor: 'rgba(0,0,0,0.3)' },
  topSection: { gap: 10 },
  statusBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center' },
  bottomSection: { gap: 15, width: '100%' },
  sliderPanel: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, paddingHorizontal: 15, paddingVertical: 5 },
  playPauseBtn: { marginRight: 5, justifyContent: 'center', alignItems: 'center', width: 30, height: 30 },
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