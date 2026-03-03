import React from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { MaterialIcons } from '@expo/vector-icons';
import Logo from '../components/Logo';

export default function LandingScreen() {
  const router = useRouter();

  // Extract provider configuration from expo-constants
  const provider = Constants.expoConfig?.extra?.provider || {
    name: 'Rocca',
    primaryColor: '#3B82F6',
    secondaryColor: '#E1EFFF',
    accentColor: '#10B981',
    welcomeMessage: 'Your identity, rewarded.',
    showRewards: true,
    showFeeDelegation: true,
    showIdentityManagement: true,
  };

  const {
    name,
    primaryColor,
    secondaryColor,
    accentColor,
    welcomeMessage,
    showRewards,
    showFeeDelegation,
    showIdentityManagement,
  } = provider;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: '#F8FAFC' }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Logo size={40} />
            <View>
              <Text style={styles.welcomeText}>{welcomeMessage}</Text>
              <Text style={styles.userName}>{name} Wallet</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.profileButton}>
            <MaterialIcons name="account-circle" size={32} color={primaryColor} />
          </TouchableOpacity>
        </View>

        <View style={[styles.balanceCard, { backgroundColor: primaryColor }]}>
          <View style={styles.cardHeader}>
            <Text style={styles.balanceLabel}>Total Balance</Text>
            <MaterialIcons name="visibility" size={20} color="rgba(255, 255, 255, 0.6)" />
          </View>
          <Text style={styles.balanceAmount}>$1,234.56</Text>
          <View style={styles.actionButtons}>
            <TouchableOpacity style={styles.actionButton}>
              <MaterialIcons name="send" size={20} color="#FFFFFF" />
              <Text style={styles.actionButtonText}>Send</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton}>
              <MaterialIcons name="call-received" size={20} color="#FFFFFF" />
              <Text style={styles.actionButtonText}>Receive</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton}>
              <MaterialIcons name="swap-horiz" size={20} color="#FFFFFF" />
              <Text style={styles.actionButtonText}>Swap</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Your Identity (DID)</Text>
            <TouchableOpacity>
              <Text style={[styles.seeAll, { color: primaryColor }]}>View Doc</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.didCard}>
            <View style={styles.didInfo}>
              <MaterialIcons name="verified" size={20} color={accentColor} />
              <Text style={[styles.didText, { flex: 1 }]} numberOfLines={1} ellipsizeMode="middle">
                did:key:z6MkpTHR8VNs2at7P7w7rCY3mXo4Luc1eFdXpm6wm9fY2i3a
              </Text>
            </View>
            <TouchableOpacity onPress={() => alert('DID copied!')}>
              <MaterialIcons name="content-copy" size={20} color="#64748B" />
            </TouchableOpacity>
          </View>
        </View>

        {(showRewards || showFeeDelegation || showIdentityManagement) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Provider Services</Text>
            <View style={styles.serviceGrid}>
              {showRewards && (
                <TouchableOpacity style={styles.serviceItem}>
                  <View style={[styles.serviceIcon, { backgroundColor: secondaryColor }]}>
                    <MaterialIcons name="card-giftcard" size={28} color={primaryColor} />
                  </View>
                  <Text style={styles.serviceLabel}>Rewards</Text>
                  <Text style={styles.serviceSubLabel}>340 pts</Text>
                </TouchableOpacity>
              )}
              {showFeeDelegation && (
                <TouchableOpacity style={styles.serviceItem}>
                  <View style={[styles.serviceIcon, { backgroundColor: '#ECFDF5' }]}>
                    <MaterialIcons name="local-gas-station" size={28} color="#10B981" />
                  </View>
                  <Text style={styles.serviceLabel}>Free Fees</Text>
                  <Text style={styles.serviceSubLabel}>Enabled</Text>
                </TouchableOpacity>
              )}
              {showIdentityManagement && (
                <TouchableOpacity style={styles.serviceItem}>
                  <View style={[styles.serviceIcon, { backgroundColor: '#FDF2F2' }]}>
                    <MaterialIcons name="security" size={28} color="#EF4444" />
                  </View>
                  <Text style={styles.serviceLabel}>Security</Text>
                  <Text style={styles.serviceSubLabel}>Shielded</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          <View style={styles.activityCard}>
            <View style={styles.activityItem}>
              <View style={[styles.activityIcon, { backgroundColor: '#F1F5F9' }]}>
                <MaterialIcons name="history" size={20} color="#64748B" />
              </View>
              <View style={styles.activityDetails}>
                <Text style={styles.activityTitle}>Onboarding Reward</Text>
                <Text style={styles.activityTime}>Just now</Text>
              </View>
              <Text style={[styles.activityAmount, { color: accentColor }]}>+50 pts</Text>
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={styles.resetButton}
          onPress={() => router.replace('/onboarding')}
        >
          <Text style={styles.resetButtonText}>Logout & Reset Onboarding</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    marginTop: 10,
  },
  welcomeText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  userName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0F172A',
  },
  profileButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  balanceCard: {
    borderRadius: 24,
    padding: 24,
    marginBottom: 32,
    elevation: 8,
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  balanceLabel: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 14,
    fontWeight: '600',
  },
  balanceAmount: {
    color: '#FFFFFF',
    fontSize: 38,
    fontWeight: '800',
    marginBottom: 24,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  section: {
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 16,
  },
  seeAll: {
    fontSize: 14,
    fontWeight: '600',
  },
  didCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  didInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  didText: {
    color: '#334155',
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '500',
  },
  serviceGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  serviceItem: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  serviceIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  serviceLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  serviceSubLabel: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  activityCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  activityIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  activityDetails: {
    flex: 1,
  },
  activityTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  activityTime: {
    fontSize: 12,
    color: '#94A3B8',
  },
  activityAmount: {
    fontSize: 14,
    fontWeight: '700',
  },
  resetButton: {
    marginTop: 8,
    padding: 16,
    alignItems: 'center',
  },
  resetButtonText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '500',
  }
});
