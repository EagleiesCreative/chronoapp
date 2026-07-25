'use client';

import { useEffect, useState } from 'react';
import { BoothLayout } from '@/components/booth/BoothLayout';
import { TenantLoginScreen } from '@/components/booth/TenantLoginScreen';
import { useAdminStore } from '@/store/booth-store';
import { useTenantStore } from '@/store/tenant-store';
import { useSessionProfileStore } from '@/store/session-profile-store';
import { Settings, X, Camera, LogOut, Lock, Loader2, FolderOpen, Image as ImageIcon, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FrameManager, PrinterSelector, CameraSelector, BackgroundSettings, PrintHistory, SessionManager, SessionSelector, LocalBackupSettings, AppUpdater } from '@/components/admin';
import { motion, AnimatePresence } from 'framer-motion';
import { formatIDR } from '@/lib/xendit';
import { Booth, getActiveBoothSession } from '@/lib/supabase';
import { useHeartbeat } from '@/hooks/useHeartbeat';
import { usePrintStore } from '@/store/print-store';
import { useUploadQueue } from '@/hooks/useUploadQueue';
import { setReliabilitySyncConfig } from '@/lib/reliability-sync';
import { toast } from 'sonner';
import { getApiUrl, apiJson, apiFetch } from '@/lib/api';
import { getVersion } from '@tauri-apps/api/app';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function HomePage() {
  const { showAdminPanel, setShowAdminPanel } = useAdminStore();
  const { setBooth: setTenantBooth } = useTenantStore();
  const { setActiveSession } = useSessionProfileStore();
  const printHistory = usePrintStore((state) => state.history);
  const { queueCount } = useUploadQueue();
  const [booth, setBooth] = useState<Booth | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  // PIN protection state
  const [adminPinVerified, setAdminPinVerified] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pin, setPin] = useState('');
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  // UX Improvement: Active Tab state persistence
  const [activeTab, setActiveTab] = useState('sessions');

  // UX Improvement: Live Diagnostics Network Status state
  const [isOnline, setIsOnline] = useState(typeof window !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedTab = localStorage.getItem('admin_active_tab');
      if (savedTab) {
        setActiveTab(savedTab);
      }
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    localStorage.setItem('admin_active_tab', value);
  };

  const successfulPrints = printHistory.filter((job) => job.status === 'success').length;
  const configuredPrintsRemaining = booth?.prints_remaining;
  const printsRemaining = typeof configuredPrintsRemaining === 'number'
    ? Math.max(0, configuredPrintsRemaining - successfulPrints)
    : Math.max(0, 200 - successfulPrints);

  const latestPrint = printHistory[0];
  const printerStatus = latestPrint?.status === 'failed' ? 'error' : (queueCount > 5 ? 'warning' : 'ready');

  // Send heartbeat + vitals to track device status (for admin dashboard)
  useHeartbeat({
    isAuthenticated: !!booth,
    vitals: {
      status: typeof navigator !== 'undefined' && navigator.onLine ? 'online' : 'offline',
      camera_battery: null,
      printer_status: printerStatus,
      prints_remaining: printsRemaining,
    },
  });

  // Configure Rust background sync target once on mount
  useEffect(() => {
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'https://chronosnap.eagleies.com';
    setReliabilitySyncConfig(apiBaseUrl);
  }, []);

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

            // Prefer the active session the server already resolved (service
            // role, authoritative price). Fall back to the client fetch only if
            // the server didn't include it.
            try {
              const activeSession = boothData.activeSession
                ?? await getActiveBoothSession(boothData.booth.id);
              setActiveSession(activeSession);
            } catch (e) {
              console.error('Failed to fetch active booth session:', e);
            }
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
      const response = await apiFetch('/api/admin', {
        method: 'POST',
        body: JSON.stringify({ pin }),
      });

      const data = await response.json();

      if (data.success) {
        if (data.token) {
          localStorage.setItem('admin_token', data.token);
        }
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
    localStorage.removeItem('admin_token');
    setAdminPinVerified(false);
    setShowAdminPanel(false);
    toast.success('Admin panel locked');
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/booth-login', { method: 'DELETE' });
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
  const handleLogin = async (boothInfo: Booth) => {
    setBooth(boothInfo);
    setTenantBooth(boothInfo);

    // Pull the full booth (with price) and its active session from the server,
    // so the idle/payment screens show the authoritative session price right
    // away instead of booth defaults.
    try {
      const boothData = await apiJson<any>(`/api/booth/${boothInfo.id}`);
      if (boothData?.booth) {
        setBooth(boothData.booth);
        setTenantBooth(boothData.booth);
      }
      const activeSession = boothData?.activeSession
        ?? await getActiveBoothSession(boothInfo.id);
      setActiveSession(activeSession);
    } catch (e) {
      console.error('Failed to fetch active booth session:', e);
    }
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
            className="fixed inset-0 z-100 bg-black/50 flex items-center justify-center p-4"
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
            className="fixed inset-0 z-100 bg-white"
          >
            {/* Header */}
            <header className="h-20 border-b flex items-center justify-between px-6 bg-white select-none">
              <div className="flex items-center gap-3">
                <Camera className="w-5 h-5 text-primary" />
                <div>
                  <h1 className="text-lg font-semibold leading-tight">Admin Panel</h1>
                  <p className="text-xs text-muted-foreground">
                    {booth.name} • {formatIDR(booth.price)}
                    {appVersion && ` • v${appVersion}`}
                  </p>
                  
                  {/* Live Diagnostics Bar */}
                  <div className="flex items-center gap-2 mt-1">
                    {/* Network Status indicator */}
                    <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-gray-50 px-2 py-0.5 rounded-full border border-gray-100">
                      <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-destructive'}`} />
                      <span>{isOnline ? 'Network Online' : 'Offline'}</span>
                    </div>

                    {/* Printer Status indicator */}
                    <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-gray-50 px-2 py-0.5 rounded-full border border-gray-100">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        printerStatus === 'ready' 
                          ? 'bg-emerald-500' 
                          : printerStatus === 'warning' 
                            ? 'bg-amber-500 animate-pulse' 
                            : 'bg-destructive animate-pulse'
                      }`} />
                      <span>
                        {printerStatus === 'ready' 
                          ? 'Printer Ready' 
                          : printerStatus === 'warning' 
                            ? 'Print Queue High' 
                            : 'Printer Error'}
                      </span>
                    </div>

                    {/* Prints Remaining count */}
                    <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-gray-50 px-2 py-0.5 rounded-full border border-gray-100">
                      <span>🖨️ {printsRemaining} Prints Left</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <SessionSelector />
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
            <div className="h-[calc(100vh-5rem)] w-full overflow-y-auto bg-linear-to-b from-gray-50 to-gray-100/80 p-6">
              <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
                <TabsList className="sticky top-0 z-20 mx-auto flex w-fit justify-center border border-gray-200/80 bg-white/85 backdrop-blur px-1.5 py-1.5 shadow-sm">
                  <TabsTrigger value="sessions" className="gap-2 rounded-full px-4 data-[state=active]:bg-emerald-50 data-[state=active]:text-emerald-700 data-[state=active]:shadow-none">
                    <FolderOpen className="w-4 h-4" />
                    Sessions
                  </TabsTrigger>
                  <TabsTrigger value="frames" className="gap-2 rounded-full px-4 data-[state=active]:bg-sky-50 data-[state=active]:text-sky-700 data-[state=active]:shadow-none">
                    <ImageIcon className="w-4 h-4" />
                    Frames
                  </TabsTrigger>
                  <TabsTrigger value="booth-settings" className="gap-2 rounded-full px-4 data-[state=active]:bg-amber-50 data-[state=active]:text-amber-700 data-[state=active]:shadow-none">
                    <Settings className="w-4 h-4" />
                    Booth Settings
                  </TabsTrigger>
                  <TabsTrigger value="config" className="gap-2 rounded-full px-4 data-[state=active]:bg-violet-50 data-[state=active]:text-violet-700 data-[state=active]:shadow-none">
                    <Wrench className="w-4 h-4" />
                    Config
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="sessions">
                  <SessionManager />
                </TabsContent>

                <TabsContent value="frames">
                  <FrameManager />
                </TabsContent>

                <TabsContent value="booth-settings">
                  <BackgroundSettings />
                </TabsContent>

                <TabsContent value="config" className="space-y-6">
                  <AppUpdater />
                  <LocalBackupSettings />
                  <CameraSelector />
                  <PrinterSelector />
                  <PrintHistory />

                  <Card className="border">
                    <CardHeader>
                      <CardTitle>Xendit Configuration</CardTitle>
                      <CardDescription>
                        Payment gateway settings
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Configure your Xendit API keys in environment variables:
                      </p>
                      <ul className="text-sm space-y-1 text-muted-foreground list-disc list-inside">
                        <li><code className="bg-gray-100 px-1 rounded text-xs">XENDIT_SECRET_KEY</code></li>
                        <li><code className="bg-gray-100 px-1 rounded text-xs">XENDIT_WEBHOOK_TOKEN</code></li>
                      </ul>
                    </CardContent>
                  </Card>

                  <Card className="border">
                    <CardHeader>
                      <CardTitle>Supabase Configuration</CardTitle>
                      <CardDescription>
                        Database and storage settings
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Configure Supabase in environment variables:
                      </p>
                      <ul className="text-sm space-y-1 text-muted-foreground list-disc list-inside">
                        <li><code className="bg-gray-100 px-1 rounded text-xs">NEXT_PUBLIC_SUPABASE_URL</code></li>
                        <li><code className="bg-gray-100 px-1 rounded text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code></li>
                      </ul>
                    </CardContent>
                  </Card>

                  <Card className="border">
                    <CardHeader>
                      <CardTitle>Admin PIN</CardTitle>
                      <CardDescription>
                        Security settings
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        Set <code className="bg-gray-100 px-1 rounded text-xs">ADMIN_PIN</code> in your environment variables to change the admin PIN.
                      </p>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
