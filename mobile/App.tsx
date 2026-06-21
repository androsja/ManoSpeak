import React from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import { MainScreen } from './src/components/MainScreen';

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <MainScreen />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
});
