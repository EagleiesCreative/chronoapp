import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
    try {
        // Simple database connectivity check
        const { error } = await supabase.from('booths').select('id').limit(1);

        if (error) {
            return NextResponse.json(
                { status: 'unhealthy', error: 'Database connection failed' },
                { status: 503 }
            );
        }

        return NextResponse.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || '1.0.0',
        });
    } catch (error) {
        return NextResponse.json(
            {
                status: 'unhealthy',
                error: error instanceof Error ? error.message : 'Health check failed'
            },
            { status: 503 }
        );
    }
}
