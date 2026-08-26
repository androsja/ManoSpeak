import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type {
  BillingPlan,
  BillingSandboxEntitlement,
} from '../services/BillingSandboxService';

type BillingSandboxSheetProps = {
  visible: boolean;
  entitlement: BillingSandboxEntitlement;
  feedback: string;
  onClose: () => void;
  onPurchase: (plan: BillingPlan) => void;
  onRestore: () => void;
  onReset: () => void;
};

const PLANS: Array<{
  id: BillingPlan;
  name: string;
  price: string;
  detail: string;
}> = [
  {id: 'monthly', name: 'PLUS MENSUAL', price: '$14.900 COP / mes', detail: 'Cancela cuando quieras'},
  {id: 'annual', name: 'PLUS ANUAL', price: '$119.900 COP / año', detail: 'Dos meses de ahorro'},
];

export function BillingSandboxSheet({
  visible,
  entitlement,
  feedback,
  onClose,
  onPurchase,
  onRestore,
  onReset,
}: BillingSandboxSheetProps) {
  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar planes de VOZUAL"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.sheet}>
          <View style={styles.testBanner}>
            <Text style={styles.testBannerText}>ENTORNO DE PRUEBA · NO HABRÁ NINGÚN COBRO</Text>
          </View>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>VOZUAL Plus</Text>
              <Text style={styles.subtitle}>Traduce sin límite, usa Por frase y abre la ventana flotante.</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Cerrar" onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>

          {entitlement.active ? (
            <View style={styles.activeCard}>
              <Text style={styles.activeTitle}>PLUS DE PRUEBA ACTIVO ✓</Text>
              <Text style={styles.activeDetail}>
                Plan {entitlement.plan === 'annual' ? 'anual' : 'mensual'}. Todos los modos están desbloqueados en este dispositivo.
              </Text>
            </View>
          ) : (
            <View style={styles.planList}>
              {PLANS.map(plan => (
                <Pressable
                  key={plan.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Probar ${plan.name}, ${plan.price}`}
                  onPress={() => onPurchase(plan.id)}
                  style={styles.planCard}
                >
                  <View>
                    <Text style={styles.planName}>{plan.name}</Text>
                    <Text style={styles.planDetail}>{plan.detail}</Text>
                  </View>
                  <Text style={styles.planPrice}>{plan.price}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {!!feedback && <Text style={styles.feedback}>{feedback}</Text>}

          <Pressable accessibilityRole="button" onPress={onRestore} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>RESTAURAR COMPRA DE PRUEBA</Text>
          </Pressable>
          {entitlement.active && (
            <Pressable accessibilityRole="button" onPress={onReset} style={styles.resetButton}>
              <Text style={styles.resetButtonText}>REINICIAR ESTADO DE PRUEBA</Text>
            </Pressable>
          )}
          <Text style={styles.legal}>
            Estos precios son de referencia para revisar la interfaz. En producción, Google Play o App Store mostrarán el precio y procesarán el pago.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {flex: 1, justifyContent: 'flex-end', backgroundColor: '#020812B8'},
  sheet: {padding: 20, paddingBottom: 28, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: '#102337', borderWidth: 1, borderColor: '#31506A'},
  testBanner: {paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#3B3020', borderWidth: 1, borderColor: '#E9B949', alignItems: 'center'},
  testBannerText: {color: '#FFE29A', fontSize: 9, fontWeight: '900', letterSpacing: 0.35},
  header: {flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 18},
  headerCopy: {flex: 1},
  title: {color: '#F7F9FC', fontSize: 25, fontWeight: '900'},
  subtitle: {color: '#A9B8C9', fontSize: 13, lineHeight: 19, marginTop: 6},
  closeButton: {width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#20344B'},
  closeText: {color: '#D8E1EC', fontSize: 25, lineHeight: 28},
  planList: {gap: 10, marginTop: 20},
  planCard: {minHeight: 72, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#16D9D1', backgroundColor: '#071829', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12},
  planName: {color: '#F7F9FC', fontSize: 13, fontWeight: '900'},
  planDetail: {color: '#7F91A6', fontSize: 10, marginTop: 4},
  planPrice: {color: '#69DDD9', fontSize: 12, fontWeight: '900', textAlign: 'right'},
  activeCard: {padding: 16, marginTop: 20, borderRadius: 14, backgroundColor: '#15394B', borderWidth: 1, borderColor: '#69DDD9'},
  activeTitle: {color: '#69DDD9', fontSize: 13, fontWeight: '900'},
  activeDetail: {color: '#D8E1EC', fontSize: 11, lineHeight: 16, marginTop: 6},
  feedback: {color: '#FFE29A', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 14},
  secondaryButton: {height: 46, marginTop: 16, borderRadius: 12, borderWidth: 1, borderColor: '#69DDD9', alignItems: 'center', justifyContent: 'center'},
  secondaryButtonText: {color: '#69DDD9', fontSize: 11, fontWeight: '900'},
  resetButton: {height: 40, marginTop: 8, alignItems: 'center', justifyContent: 'center'},
  resetButtonText: {color: '#F06275', fontSize: 10, fontWeight: '800'},
  legal: {color: '#7F91A6', fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 14},
});
