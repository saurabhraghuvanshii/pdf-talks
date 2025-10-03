"use client";

import { cn } from "@/lib/utils";

interface TypingAnimationProps {
    className?: string;
    variant?: "blue";
}

export function TypingAnimation({
    className,
    variant = "blue"
}: TypingAnimationProps) {
    const renderBlueDots = () => (
        <div className="flex space-x-1.5">
            {[0, 160, 320].map((delay, index) => (
                <div
                    key={index}
                    className="typing-dot w-2.5 h-2.5"
                    style={{
                        animationDelay: `${delay}ms`,
                    }}
                />
            ))}
        </div>
    );

    const variants = {
        blue: renderBlueDots,
    };

    return (
        <div className={cn("flex items-center justify-center", className)}>
            {variants[variant]()}
        </div>
    );
}
