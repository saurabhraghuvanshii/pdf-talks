"use client";

interface FileChipProps {
    file: {
        id: string;
        name: string;
        url?: string;
        supabasePath?: string;
    };
    onClick: () => void;
}

export function FileChip({ file, onClick }: FileChipProps) {
    return (
        <div
            className="flex items-center gap-2 bg-blue-50 hover:bg-blue-100 rounded-full px-3 py-1.5 cursor-pointer transition-colors"
            onClick={onClick}
        >
            <div className="w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
                <svg className="w-2 h-2 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                </svg>
            </div>
            <span className="text-sm font-medium text-blue-800 truncate max-w-[150px]">
                {file.name}
            </span>
            <span className="text-xs text-blue-600 bg-blue-200 px-1.5 py-0.5 rounded">
                PDF
            </span>
        </div>
    );
}