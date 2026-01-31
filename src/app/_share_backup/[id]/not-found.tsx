import Link from 'next/link';
import { ImageOff } from 'lucide-react';

export default function ShareNotFound() {
    return (
        <div className="min-h-screen bg-white flex flex-col items-center justify-center p-8">
            <div className="text-center max-w-sm">
                <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <ImageOff className="w-10 h-10 text-gray-400" />
                </div>

                <h1 className="text-2xl font-medium text-gray-900 mb-2">
                    Photo Not Found
                </h1>

                <p className="text-gray-500 mb-8">
                    This photo session may have expired or doesn't exist.
                </p>

                <Link
                    href="/"
                    className="inline-flex items-center justify-center bg-gray-900 text-white py-3 px-8 rounded-full font-medium hover:bg-gray-800 transition-colors"
                >
                    Go to ChronoSnap
                </Link>
            </div>

            <p className="text-xs text-gray-400 mt-auto pt-8">
                Powered by <span className="font-medium">ChronoSnap</span>
            </p>
        </div>
    );
}
