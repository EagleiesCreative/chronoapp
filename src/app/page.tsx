'use client';

import { useEffect, useState } from 'react';
import { BoothLayout } from '@/components/booth/BoothLayout';
import { TenantLoginScreen } from '@/components/booth/TenantLoginScreen';
import { useAdminStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { Settings, X, Camera, LogOut, Lock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FrameManager, PrinterSelector, CameraSelector, BackgroundSettings } from '@/components/admin';
import { motion, AnimatePresence } from 'framer-motion';
import { formatIDR } from '@/lib/xendit';
import { Booth } from '@/lib/supabase';
import { useHeartbeat } from '@/hooks/useHeartbeat';
import { toast } from 'sonner';
import { getApiUrl, apiJson } from '@/lib/api';

export default function HomePage() {
  const { showAdminPanel, setShowAdminPanel } = useAdminStore();
  const { setBooth: setTenantBooth } = useTenantStore();
  const [booth, setBooth] = useState<Booth | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  // PIN protection state
  const [adminPinVerified, setAdminPinVerified] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pin, setPin] = useState('');
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);

  // Send heartbeat to track device status (for admin dashboard)
  useHeartbeat({ isAuthenticated: !!booth });

  // Check existing session on mount
  useEffect(() => {
    async function checkSession() {
      try {
        const data = await apiJson<any>('/api/auth/booth-login');

        if (data.authenticated && data.booth) {
          // Fetch full booth info with price
          const boothData = await apiJson<any>(`/api/booth/${data.booth.id}`);
          if (boothData.booth) {
            setBooth(boothData.booth);
            // Also save to tenant store for FrameSelector/PaymentScreen
            setTenantBooth(boothData.booth);
          }
        } else if (data.reason === 'logged_in_elsewhere') {
          // Session was invalidated because booth logged in on another device
          alert('Session expired: This booth code was used to login on another device. Please login again.');
          setBooth(null);
          setTenantBooth(null);
        }
      } catch (error) {
        console.error('Session check error:', error);
      } finally {
        setIsCheckingSession(false);
      }
    }

    checkSession();
  }, [setTenantBooth]);

  // Admin panel shortcut (Ctrl+Shift+A)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        handleAdminAccess();
      }

      if (e.key === 'Escape') {
        if (showPinDialog) {
          setShowPinDialog(false);
          setPin('');
        } else if (showAdminPanel) {
          setShowAdminPanel(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showAdminPanel, showPinDialog, adminPinVerified, setShowAdminPanel]);

  // Handle admin access - check if PIN verified
  const handleAdminAccess = () => {
    if (adminPinVerified) {
      setShowAdminPanel(!showAdminPanel);
    } else {
      setShowPinDialog(true);
    }
  };

  // Verify PIN
  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) {
      toast.error('Please enter the admin PIN');
      return;
    }

    setIsVerifyingPin(true);
    try {
      const response = await fetch(getApiUrl('/api/admin'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pin }),
      });

      const data = await response.json();

      if (data.success) {
        setAdminPinVerified(true);
        setShowPinDialog(false);
        setShowAdminPanel(true);
        setPin('');
        toast.success('Admin access granted');
      } else {
        toast.error(data.error || 'Invalid PIN');
      }
    } catch {
      toast.error('Verification failed');
    } finally {
      setIsVerifyingPin(false);
    }
  };

  // Lock admin panel (require PIN again)
  const handleLockAdmin = () => {
    setAdminPinVerified(false);
    setShowAdminPanel(false);
    toast.success('Admin panel locked');
  };

  const handleLogout = async () => {
    try {
      await fetch(getApiUrl('/api/auth/booth-login'), { method: 'DELETE', credentials: 'include' });
      setBooth(null);
      setShowAdminPanel(false);
      setAdminPinVerified(false);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // Loading state
  if (isCheckingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // Handle login - save to both local state and tenant store
  const handleLogin = (boothInfo: Booth) => {
    setBooth(boothInfo);
    setTenantBooth(boothInfo);
  };

  // Show tenant login if no booth authenticated
  if (!booth) {
    return <TenantLoginScreen onLogin={handleLogin} />;
  }

  return (
    <main className="min-h-screen">
      {/* Main booth interface */}
      <BoothLayout />

      {/* Hidden admin button (corner tap) */}
      <button
        onClick={handleAdminAccess}
        className="fixed top-4 right-4 w-12 h-12 opacity-0 hover:opacity-10 transition-opacity z-50"
        aria-label="Open admin panel"
      >
        <Settings className="w-6 h-6" />
      </button>

      {/* PIN Dialog */}
      <AnimatePresence>
        {showPinDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4"
            onClick={() => {
              setShowPinDialog(false);
              setPin('');
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl p-8 w-full max-w-sm shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-gray-100 mb-4">
                  <Lock className="w-6 h-6 text-primary" />
                </div>
                <h2 className="text-xl font-semibold">Admin Access</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter PIN to access admin panel
                </p>
              </div>

              <form onSubmit={handlePinSubmit} className="space-y-4">
                <Input
                  type="password"
                  placeholder="Enter PIN"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  className="text-center text-lg tracking-widest"
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setShowPinDialog(false);
                      setPin('');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="flex-1"
                    disabled={isVerifyingPin}
                  >
                    {isVerifyingPin ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      'Unlock'
                    )}
                  </Button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full-screen Admin Panel Overlay */}
      <AnimatePresence>
        {showAdminPanel && adminPinVerified && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-white"
          >
            {/* Header */}
            <header className="h-16 border-b flex items-center justify-between px-6 bg-white">
              <div className="flex items-center gap-3">
                <Camera className="w-5 h-5 text-primary" />
                <div>
                  <h1 className="text-lg font-semibold">Admin Panel</h1>
                  <p className="text-xs text-muted-foreground">
                    {booth.name} • {formatIDR(booth.price)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLockAdmin}
                  className="text-amber-600 hover:text-amber-700"
                >
                  <Lock className="w-4 h-4 mr-2" />
                  Lock
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLogout}
                  className="text-destructive hover:text-destructive"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Logout Booth
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowAdminPanel(false)}
                  className="hover:bg-gray-100"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </header>

            {/* Content */}
            <div className="h-[calc(100vh-4rem)] overflow-y-auto bg-gray-50 p-6 space-y-6">
              <FrameManager />
              <BackgroundSettings />
              <CameraSelector />
              <PrinterSelector />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
