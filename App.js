import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Alert,
  Button,
  Platform,
  PermissionsAndroid,
  Linking,
} from 'react-native';
import GoogleFit, { Scopes as GFScopes } from 'react-native-google-fit';
import AppleHealthKit from 'react-native-health';
import BackgroundFetch from 'react-native-background-fetch';
import { NativeModules } from 'react-native';

const { HealthConnectModule } = NativeModules;

export default function App() {
  const [metrics, setMetrics] = useState({ steps: null, sleep: null, heartRate: null, systolicBP: null, diastolicBP: null, oxygen: null, respRate: null, bodyTemp: null, glucose: null });
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');

  useEffect(() => {
    Platform.OS === 'android' ? initializeAndroid() : initializeHealthKit();
    initBackgroundFetch();
  }, []);

  const initializeAndroid = async () => {
    setConnectionStatus('connecting');

    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION
    );
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {

      Alert.alert('دسترسی رد شد', 'برای ادامه نیاز به اجازه دارید.');
      setIsLoading(false);
      setConnectionStatus('disconnected');
      return;
    }

    try {
      const isHCInstalled = await HealthConnectModule.isAvailable();
      if (!isHCInstalled) {
        setIsLoading(false); // ✅ اول بارگذاری را خاموش کن
        setConnectionStatus('disconnected');
        Alert.alert(
          'Health Connect نصب نیست',
          'برای ادامه باید Health Connect نصب شود.',
          [
            {
              text: 'نصب',
              onPress: () =>
                Linking.openURL('market://details?id=com.google.android.apps.healthdata'),
            },
          ]
        );
        return;
      }

      const data = await HealthConnectModule.getHealthDataFull();
      handleData(data);
      setConnectionStatus('connected');
    } catch (e) {
      console.warn('Health Connect Error:', e);
      await initializeGoogleFit();
    } finally {
      setIsLoading(false);
    }
  };

  const initializeGoogleFit = async () => {
    try {
      const isAuth = await GoogleFit.checkIsAuthorized();
      if (!isAuth) {
        const res = await GoogleFit.authorize({
          scopes: [
            GFScopes.FITNESS_ACTIVITY_READ,
            GFScopes.FITNESS_SLEEP_READ,
            GFScopes.FITNESS_HEART_RATE_READ,
            GFScopes.FITNESS_BLOOD_PRESSURE_READ,
            GFScopes.FITNESS_OXYGEN_SATURATION_READ,
            GFScopes.FITNESS_RESPIRATORY_RATE_READ,
            GFScopes.FITNESS_BODY_TEMPERATURE_READ,
            GFScopes.FITNESS_NUTRITION_READ,
          ],
        });

        if (!res.success) {
          Alert.alert('عدم اجازه', 'دسترسی به Google Fit رد شد');
          setConnectionStatus('disconnected');
          return;
        }
      }

      await fetchGoogleFitData();
    } catch (err) {
      console.error('Google Fit Auth Error:', err);
      setConnectionStatus('disconnected');
    }
  };

  const fetchGoogleFitData = async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const opts = {
        startDate: today.toISOString(),
        endDate: new Date().toISOString(),
      };

      const [stepsRes, sleepRes, hr, bp, ox, rr, temp, glu] = await Promise.all([
        GoogleFit.getDailyStepCountSamples(opts),
        GoogleFit.getSleepData(opts),
        GoogleFit.getHeartRateSamples(opts),
        GoogleFit.getBloodPressure(opts),
        GoogleFit.getOxygenSaturation(opts),
        GoogleFit.getRespiratoryRate(opts),
        GoogleFit.getBodyTemperature(opts),
        GoogleFit.getBloodGlucose(opts),
      ]);

      const data = {
        steps: stepsRes.find(r => r.source.includes('estimated_steps'))?.steps?.[0]?.value ?? null,
        sleep: sleepRes.length,
        heartRate: hr?.[0]?.value ?? null,
        systolicBP: bp?.[0]?.systolic ?? null,
        diastolicBP: bp?.[0]?.diastolic ?? null,
        oxygen: ox?.[0]?.value ?? null,
        respRate: rr?.[0]?.value ?? null,
        bodyTemp: temp?.[0]?.value ?? null,
        glucose: glu?.[0]?.value ?? null,
      };

      handleData(data);
      setConnectionStatus('connected');
    } catch (err) {
      console.error('Error fetching Google Fit data:', err);
      setConnectionStatus('disconnected');
    }
  };

  const initializeHealthKit = () => {
    AppleHealthKit.initHealthKit({
      permissions: {
        read: [
          'Steps',
          'SleepAnalysis',
          'HeartRate',
          'BloodPressureSystolic',
          'BloodPressureDiastolic',
          'OxygenSaturation',
          'RespiratoryRate',
          'BodyTemperature',
          'BloodGlucose',
        ],
      },
    }, (err) => {
      if (err) {
        console.error('HealthKit error:', err);
        return setIsLoading(false);
      }
      fetchHealthKit();
    });
  };

  const fetchHealthKit = () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let data = { ...metrics };
    let done = 0;
    const trySet = () => {
      done++;
      if (done === 3) handleData(data);
    };

    AppleHealthKit.getStepCount({ startDate: today.toISOString() }, (e, r) => {
      if (!e) data.steps = r.value;
      trySet();
    });
    AppleHealthKit.getSleepSamples({ startDate: today.toISOString() }, (e, r) => {
      if (!e) data.sleep = r.length;
      trySet();
    });
    AppleHealthKit.getHeartRateSamples({ startDate: today.toISOString() }, (e, r) => {
      if (!e && r.length) data.heartRate = r[0].value;
      trySet();
    });
  };

  const handleData = async (data) => {
    setMetrics(data);
    setIsLoading(false);
    await sendToBackend(data);
  };

  const sendToBackend = async (data) => {
    const body = {
      patient: 1,
      steps: data.steps,
      sleep: data.sleep,
      heart_rate: data.heartRate,
      systolic_bp: data.systolicBP,
      diastolic_bp: data.diastolicBP,
      oxygen_saturation: data.oxygen,
      respiratory_rate: data.respRate,
      body_temperature: data.bodyTemp,
      blood_glucose: data.glucose,
      recorded_at: new Date().toISOString(),
      device_name: Platform.OS === 'ios' ? 'Apple Health' : 'Google Fit / Health Connect',
      is_connected: connectionStatus === 'connected',
    };

    try {
      const response = await fetch('https://your-backend.com/api/wearables/data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer YOUR_JWT_TOKEN', // <-- حتماً مقدار واقعی وارد کن
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const responseData = await response.json();
        console.log('Data sent successfully:', responseData);
        Alert.alert('Success', 'Health data synced successfully!');
      } else {
        console.error('Failed to send data:', response.status);
        Alert.alert('Error', 'Failed to sync health data');
      }
    } catch (error) {
      console.error('Error sending data:', error);
      Alert.alert('Error', 'Network error occurred');
    }
  };

  const initBackgroundFetch = () => {
    BackgroundFetch.configure({
      minimumFetchInterval: 1440,
      stopOnTerminate: false,
      enableHeadless: true,
      startOnBoot: true,
    }, async () => {
      Platform.OS === 'android' ? await initializeAndroid() : await initializeHealthKit();
      BackgroundFetch.finish();
    }, (err) => console.warn('BGFetch error', err));
  };

    const refreshData = () => {
      setIsLoading(true);
      Platform.OS === 'android' ? initializeAndroid() : initializeHealthKit();
    };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>سلامت امروز</Text>
      <Text style={styles.statusText}>وضعیت اتصال: {connectionStatus}</Text>
      {isLoading ? (
        <Text>در حال بارگذاری …</Text>
      ) : (
        <View style={styles.dataContainer}>
          <Text style={styles.dataTitle}>Today's Health Summary:</Text>
          <Text style={styles.dataItem}>🚶 Steps: {metrics.steps?.toLocaleString() ?? '0'}</Text>
          <Text style={styles.dataItem}>📏 Distance: {((metrics.distance ?? 0) / 1000).toFixed(1)} km</Text>
          <Text style={styles.dataItem}>🔥 Calories: {metrics.calories ?? '0'}</Text>
          <Text style={styles.dataItem}>❤️ Heart Rate: {metrics.heartRate ?? '0'} bpm</Text>
          <Text style={styles.dataItem}>🔥 sleep: {metrics.sleep ?? '0'}</Text>
          <Text style={styles.dataItem}>🔥 systolic bp: {metrics.systolicBP ?? '0'}</Text>
          <Text style={styles.dataItem}>🔥 diastolic bp: {metrics.diastolicBP ?? '0'}</Text>
          <Text style={styles.dataItem}>🔥 oxygen: {metrics.oxygen ?? '0'}</Text>
          <Text style={styles.dataItem}>🔥 body temperature: {metrics.bodyTemp ?? '0'}</Text>
          <Text style={styles.dataItem}>🔥 blood glucose: {metrics.glucose ?? '0'}</Text>
          <Button title="Refresh Data" onPress={refreshData} />
        </View>
      )}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  statusText: {
    fontSize: 16,
    marginBottom: 10,
  },
});
