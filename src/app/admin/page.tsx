'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    Settings,
    Image as ImageIcon,
    CreditCard,
    BarChart3,
    ArrowLeft,
    Camera,
    Lock,
    LogOut,
    Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FrameManager, CameraSelector, PrinterSelector } from '@/components/admin';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';

type AuthState = 'loading' | 'unauthenticated' | 'authenticated';

export default function AdminPage() {
    const [authState, setAuthState] = useState<AuthState>('loading');
    const [pin, setPin] = useState('');
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [activeTab, setActiveTab] = useState('frames');

    // Check session on mount
    useEffect(() => {
        checkAuth();
    }, []);

    async function checkAuth() {
        try {
            const response = await apiFetch('/api/admin');
            const data = await response.json();
            setAuthState(data.authenticated ? 'authenticated' : 'unauthenticated');
        } catch {
            setAuthState('unauthenticated');
        }
    }

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault();
        if (!pin.trim()) {
            toast.error('Please enter the admin PIN');
            return;
        }

        setIsLoggingIn(true);
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
                setAuthState('authenticated');
                setPin('');
                toast.success('Welcome to Admin Panel');
            } else {
                toast.error(data.error || 'Invalid PIN');
            }
        } catch {
            toast.error('Login failed');
        } finally {
            setIsLoggingIn(false);
        }
    }

    async function handleLogout() {
        try {
            await apiFetch('/api/admin', { method: 'DELETE' });
            localStorage.removeItem('admin_token');
            setAuthState('unauthenticated');
            toast.success('Logged out');
        } catch {
            toast.error('Logout failed');
        }
    }

    // Loading state
    if (authState === 'loading') {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    // Login gate
    if (authState === 'unauthenticated') {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center p-8">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full max-w-sm"
                >
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                            <Lock className="w-7 h-7 text-primary" />
                        </div>
                        <h1 className="text-2xl font-semibold mb-2">Admin Access</h1>
                        <p className="text-muted-foreground text-sm">
                            Enter your PIN to access the admin panel
                        </p>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-4">
                        <Input
                            type="password"
                            placeholder="Enter PIN"
                            value={pin}
                            onChange={(e) => setPin(e.target.value)}
                            className="text-center text-lg tracking-widest"
                            autoFocus
                        />
                        <Button
                            type="submit"
                            className="w-full"
                            disabled={isLoggingIn}
                        >
                            {isLoggingIn ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : null}
                            Unlock
                        </Button>
                    </form>

                    <div className="mt-6 text-center">
                        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
                            ← Back to Booth
                        </Link>
                    </div>
                </motion.div>
            </div>
        );
    }

    // Authenticated admin panel
    return (
        <div className="min-h-screen bg-white">
            {/* Header */}
            <header className="border-b sticky top-0 z-50 bg-white">
                <div className="container mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Link href="/">
                            <Button variant="ghost" size="icon">
                                <ArrowLeft className="w-5 h-5" />
                            </Button>
                        </Link>
                        <div className="flex items-center gap-2">
                            <Camera className="w-5 h-5 text-primary" />
                            <h1 className="text-lg font-semibold">ChronoSnap Admin</h1>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Button variant="outline" asChild>
                            <Link href="/">
                                <Camera className="w-4 h-4 mr-2" />
                                Booth
                            </Link>
                        </Button>
                        <Button variant="ghost" size="icon" onClick={handleLogout}>
                            <LogOut className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            </header>

            {/* Main content */}
            <main className="container mx-auto px-6 py-8">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                    <TabsList className="bg-gray-100">
                        <TabsTrigger value="frames" className="gap-2 data-[state=active]:bg-white">
                            <ImageIcon className="w-4 h-4" />
                            Frames
                        </TabsTrigger>
                        <TabsTrigger value="payments" className="gap-2 data-[state=active]:bg-white">
                            <CreditCard className="w-4 h-4" />
                            Payments
                        </TabsTrigger>
                        <TabsTrigger value="analytics" className="gap-2 data-[state=active]:bg-white">
                            <BarChart3 className="w-4 h-4" />
                            Analytics
                        </TabsTrigger>
                        <TabsTrigger value="settings" className="gap-2 data-[state=active]:bg-white">
                            <Settings className="w-4 h-4" />
                            Settings
                        </TabsTrigger>
                    </TabsList>

                    {/* Frames Tab */}
                    <TabsContent value="frames">
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                        >
                            <FrameManager />
                        </motion.div>
                    </TabsContent>

                    {/* Payments Tab */}
                    <TabsContent value="payments">
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                        >
                            <Card className="border">
                                <CardHeader>
                                    <CardTitle>Payment History</CardTitle>
                                    <CardDescription>
                                        View and manage payment transactions
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-center py-12 text-muted-foreground">
                                        <CreditCard className="w-12 h-12 mx-auto mb-4 opacity-30" />
                                        <p>Payment history will appear here</p>
                                        <p className="text-sm mt-1">Connect to Supabase to see transactions</p>
                                    </div>
                                </CardContent>
                            </Card>
                        </motion.div>
                    </TabsContent>

                    {/* Analytics Tab */}
                    <TabsContent value="analytics">
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                        >
                            <div className="grid gap-6 md:grid-cols-3 mb-6">
                                <Card className="border">
                                    <CardHeader className="pb-2">
                                        <CardDescription>Total Sessions</CardDescription>
                                        <CardTitle className="text-3xl">--</CardTitle>
                                    </CardHeader>
                                </Card>
                                <Card className="border">
                                    <CardHeader className="pb-2">
                                        <CardDescription>Total Revenue</CardDescription>
                                        <CardTitle className="text-3xl">Rp --</CardTitle>
                                    </CardHeader>
                                </Card>
                                <Card className="border">
                                    <CardHeader className="pb-2">
                                        <CardDescription>Active Frames</CardDescription>
                                        <CardTitle className="text-3xl">--</CardTitle>
                                    </CardHeader>
                                </Card>
                            </div>

                            <Card className="border">
                                <CardHeader>
                                    <CardTitle>Analytics Dashboard</CardTitle>
                                    <CardDescription>
                                        Session and revenue statistics
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-center py-12 text-muted-foreground">
                                        <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-30" />
                                        <p>Analytics will appear here</p>
                                        <p className="text-sm mt-1">Connect to Supabase to see statistics</p>
                                    </div>
                                </CardContent>
                            </Card>
                        </motion.div>
                    </TabsContent>

                    {/* Settings Tab */}
                    <TabsContent value="settings">
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="space-y-6"
                        >
                            <CameraSelector />

                            <PrinterSelector />

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
                        </motion.div>
                    </TabsContent>
                </Tabs>
            </main>
        </div>
    );
}
