// ⬇️ 你的 import 與初始化不變
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image } from 'react-native';
import MapView, { Marker, Callout } from 'react-native-maps';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';

const SHEET_URL = 'https://script.google.com/macros/s/AKfycbyJ25qgYw3S072SLYA-wqxjtSAAO9xHb5X4NHCC_P9sLo757vowJjivGlm_Z8Vt62teOQ/exec';
const GOOGLE_API_KEY = 'AIzaSyAgxUKSXABS9pG7rgm8NqmZLqQcVX4tAt4';
const OPENAI_API_KEY = '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';
const DEEPSEEK_API_KEY = 'sk-666e7c6ef9724265878adf56bf228f56';

export default function App() {
  const [location, setLocation] = useState(null);
  const [POIs, setPOIs] = useState([]);
  const [currentText, setCurrentText] = useState('');
  const [mode, setMode] = useState('custom');
  const [currentPOI, setCurrentPOI] = useState(null);
  const [tracking, setTracking] = useState(true);
  const [playHistory, setPlayHistory] = useState({});
  const [isSpeaking, setIsSpeaking] = useState(false);
  const mapRef = useRef(null);

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 3000,
          distanceInterval: 5,
        },
        (loc) => {
          if (tracking) {
            setLocation(loc.coords);
          }
        }
      );

      const res = await fetch(SHEET_URL);
      const data = await res.json();
      setPOIs(data);
    })();
  }, []);

  // ✅ 每次定位更新 → 若 tracking=true，自動移動地圖到使用者位置
  useEffect(() => {
    if (tracking && location && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: location.latitude,
          longitude: location.longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        },
        500
      );
    }
  }, [location, tracking]);

  // ✅ 自動接近景點播放（5分鐘內不重播）
  useEffect(() => {
    if (!location || POIs.length === 0) return;

    const now = Date.now();
    for (let poi of POIs) {
      const dist = getDistance(location.latitude, location.longitude, poi.latitude, poi.longitude);
      const lastPlayedTime = playHistory[poi.name] || 0;
      const timeSinceLast = now - lastPlayedTime;

if (dist <= 30 && timeSinceLast > 5 * 60 * 1000 && !isSpeaking) {
        handleMarkerPress(poi);
        setPlayHistory((prev) => ({ ...prev, [poi.name]: now }));
        break;
      }
    }
  }, [location]);

  const speak = (text) => {
      if (isSpeaking || !text) return; // 若正在播放或無內容，略過
    Speech.stop();
    Speech.speak(text, { language: 'zh-TW' });
    setCurrentText(text);
  };

  const stop = () => {
    Speech.stop();
    setCurrentText('');
  };

  const fetchWiki = async (title) => {
    try {
      const res = await fetch(`https://zh.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      const json = await res.json();
      return json.extract || '(無維基百科內容)';
    } catch {
      return '(維基百科查詢失敗)';
    }
  };

  const fetchGPT = async (title) => {
    const model = mode === 'deepseek' ? 'deepseek-chat' : 'gpt-3.5-turbo';
    const url =
      mode === 'deepseek'
        ? 'https://api.deepseek.com/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
    const key = mode === 'deepseek' ? DEEPSEEK_API_KEY : OPENAI_API_KEY;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: '你是一位導覽解說員，請用繁體中文介紹地點，語氣親切簡潔。限150字。',
            },
            {
              role: 'user',
              content: `請介紹一個旅遊地點「${title}」，它位於以下座標：緯度 ${currentPOI?.latitude}、經度 ${currentPOI?.longitude}。請確認是正確地點後再簡潔說明。`,
            },
          ],
        }),
      });
      const json = await res.json();
      return json.choices?.[0]?.message?.content || '(無 AI 回應)';
    } catch (err) {
      return `(錯誤：${err.message})`;
    }
  };

  const fetchPhotoUrl = async (placeName) => {
    try {
      const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
        placeName
      )}&key=${GOOGLE_API_KEY}`;
      const res = await fetch(searchUrl);
      const json = await res.json();
      const photoRef = json.results?.[0]?.photos?.[0]?.photo_reference;

      if (photoRef) {
        const photoRes = await fetch(
          `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${photoRef}&key=${GOOGLE_API_KEY}`,
          { method: 'GET', redirect: 'follow' }
        );
        return photoRes.url;
      }

      return null;
    } catch {
      return null;
    }
  };

  const handleMarkerPress = async (poi) => {
    setCurrentPOI(poi);

    if (!poi.photoUrl) {
      const url = await fetchPhotoUrl(poi.name);
      poi.photoUrl = url;
      setPOIs([...POIs]);
    }

    let text = '';
    if (mode === 'wiki') {
      text = await fetchWiki(poi.name);
    } else if (mode === 'gpt' || mode === 'deepseek') {
      text = await fetchGPT(poi.name);
    } else {
      text = poi.description;
    }

    speak(text);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>GPS 導覽系統</Text>

      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: location?.latitude || 22.985,
          longitude: location?.longitude || 120.241,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        }}
        customMapStyle={darkMapStyle}
      >
        {POIs.map((poi, idx) => (
          <Marker
            key={idx}
            coordinate={{ latitude: poi.latitude, longitude: poi.longitude }}
            title={poi.name}
            onPress={() => handleMarkerPress(poi)}
          >
            <Callout>
              <Text>📍 {poi.name}</Text>
            </Callout>
          </Marker>
        ))}
        {location && (
          <Marker pinColor="cyan" coordinate={location} title="你的位置" />
        )}
      </MapView>

      {currentPOI?.photoUrl && (
        <Image
          source={{ uri: currentPOI.photoUrl }}
          style={{ width: '100%', height: 180 }}
          resizeMode="cover"
        />
      )}

      <ScrollView style={styles.textBox}>
        <Text style={styles.textLabel}>
          {currentPOI?.name ? `目前位置：${currentPOI.name}` : '目前導覽內容：'}
        </Text>
        <Text style={styles.text}>{currentText || '(尚未播放)'}</Text>
      </ScrollView>

      <View style={styles.controls}>
        <TouchableOpacity style={styles.button} onPress={() => speak(currentText)}>
          <Text style={styles.btnText}>▶️</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={stop}>
          <Text style={styles.btnText}>⏹</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: tracking ? '#4caf50' : '#9e9e9e' },
          ]}
          onPress={() => setTracking(!tracking)}
        >
          <Text style={styles.btnText}>{tracking ? '📍' : '❌'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.button}
          onPress={() => {
            const modes = ['custom', 'wiki', 'gpt', 'deepseek'];
            const next = modes[(modes.indexOf(mode) + 1) % modes.length];
            setMode(next);
          }}
        >
          <Text style={styles.btnText}>
            {{
              custom: '自定內容',
              wiki: '維基百科',
              gpt: 'GPT',
              deepseek: 'DeepSeek',
            }[mode]}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ➕ 工具函數與樣式
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#304a7d' }] },
];

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', paddingTop: 30 },
  title: { color: 'white', fontSize: 20, textAlign: 'center', marginBottom: 5 },
  map: { width: '100%', height: '50%' },
  textBox: { padding: 10, height: 100 },
  textLabel: { color: '#aaa', fontSize: 14 },
  text: { color: 'white', fontSize: 16, marginTop: 5 },
  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    padding: 10,
    paddingBottom: 40,
  },
  button: {
    backgroundColor: '#2196f3',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    margin: 5,
  },
  btnText: { color: 'white', fontWeight: 'bold', fontSize: 14 },
});
