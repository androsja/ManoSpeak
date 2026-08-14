import React from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import { ListenerScreen } from './src/components/ListenerScreen';

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ListenerScreen />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
});
