"use client";

import { useEffect, useRef } from 'react';

interface SourceViewerProps {
    htmlContent: string;
    highlightChunkId?: string;
    citedText?: string;
    refreshKey?: number;
}

export function SourceViewer({ htmlContent, highlightChunkId, citedText, refreshKey }: SourceViewerProps) {
    const viewerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const runHighlight = () => {
            if (!viewerRef.current) return;

            const previousHighlights = viewerRef.current.querySelectorAll('.highlight');
            previousHighlights.forEach(highlight => {
                const parent = highlight.parentNode;
                if (parent) {
                    parent.replaceChild(document.createTextNode(highlight.textContent || ''), highlight);
                    parent.normalize();
                }
            });

            const normalizedCited = (citedText || '')
                .replace(/[“”"']/g, '')
                .replace(/\s+/g, ' ')
                .trim();

            if (highlightChunkId) {
                const elementsToHighlight = viewerRef.current.querySelectorAll(`[data-chunk-id="${highlightChunkId}"]`);

                if (elementsToHighlight.length > 0) {
                    let anyHighlighted = false;

                    for (const element of elementsToHighlight) {
                        if (normalizedCited) {
                            const highlighted = highlightTextInNode(element, normalizedCited);
                            if (highlighted) {
                                anyHighlighted = true;
                                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                break;
                            }
                        }
                    }

                    if (!anyHighlighted) {
                        // If quoted text not found inside the target chunk, try to highlight across the entire document
                        if (normalizedCited) {
                            const globalHighlighted = highlightAllTextOccurrences(viewerRef.current, normalizedCited);
                            if (globalHighlighted) {
                                const first = viewerRef.current.querySelector('.highlight');
                                if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                return;
                            }
                        }

                        elementsToHighlight.forEach((element, index) => {
                            element.classList.add('highlight');
                            if (index === 0) {
                                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                        });
                    }
                }
            } else if (normalizedCited) {
                highlightAllTextOccurrences(viewerRef.current, normalizedCited);
            }
        };

        // Defer to ensure DOM is fully painted before measuring/searching
        if (typeof window !== 'undefined') {
            requestAnimationFrame(() => setTimeout(runHighlight, 0));
        } else {
            runHighlight();
        }
    }, [highlightChunkId, citedText, htmlContent, refreshKey]);


    const highlightTextInNode = (node: Element, searchText: string): boolean => {
        const treeWalker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const textNodes: Text[] = [];
        let currentNode = treeWalker.nextNode();
        while (currentNode) {
            textNodes.push(currentNode as Text);
            currentNode = treeWalker.nextNode();
        }

        let highlighted = false;
        for (const textNode of textNodes) {
            const text = textNode.textContent;
            if (text) {
                const index = text.toLowerCase().indexOf(searchText.toLowerCase());
                if (index !== -1) {
                    const before = text.substring(0, index);
                    const highlightedText = text.substring(index, index + searchText.length);
                    const after = text.substring(index + searchText.length);

                    const span = document.createElement('span');
                    span.className = 'highlight';
                    span.textContent = highlightedText;

                    const parent = textNode.parentNode;
                    if (parent) {
                        parent.insertBefore(document.createTextNode(before), textNode);
                        parent.insertBefore(span, textNode);
                        parent.insertBefore(document.createTextNode(after), textNode);
                        parent.removeChild(textNode);
                        highlighted = true;
                    }
                }
            }
        }
        return highlighted;
    };

    const highlightAllTextOccurrences = (container: Element, searchText: string): boolean => {
        const treeWalker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        const textNodes: Text[] = [];
        let currentNode = treeWalker.nextNode();
        while (currentNode) {
            textNodes.push(currentNode as Text);
            currentNode = treeWalker.nextNode();
        }

        let highlighted = false;
        let firstMatch = true;

        for (const textNode of textNodes) {
            const text = textNode.textContent;
            if (text) {
                const lowerText = text.toLowerCase();
                const lowerSearch = searchText.toLowerCase();
                let index = lowerText.indexOf(lowerSearch);

                while (index !== -1) {
                    const before = text.substring(0, index);
                    const highlightedText = text.substring(index, index + searchText.length);
                    const after = text.substring(index + searchText.length);

                    const span = document.createElement('span');
                    span.className = 'highlight';
                    span.textContent = highlightedText;

                    const parent = textNode.parentNode;
                    if (parent) {
                        parent.insertBefore(document.createTextNode(before), textNode);
                        parent.insertBefore(span, textNode);
                        parent.insertBefore(document.createTextNode(after), textNode);
                        parent.removeChild(textNode);
                        highlighted = true;

                        if (firstMatch) {
                            span.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            firstMatch = false;
                        }
                    }

                    const remainingText = after;
                    const remainingLower = remainingText.toLowerCase();
                    const nextIndex = remainingLower.indexOf(lowerSearch);
                    if (nextIndex !== -1) {
                        index = index + searchText.length + nextIndex;
                    } else {
                        break;
                    }
                }
            }
        }
        return highlighted;
    };


    return (
        <div ref={viewerRef} className="h-full overflow-auto">
            <style jsx global>{`
                .document-content {
                    padding: 1.5rem 2rem;
                    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                    color: #374151;
                    line-height: 1.6;
                }
                .document-content p {
                    margin-bottom: 0.5rem;
                }
                .highlight {
                    background-color: #e0f2fe;
                    border: 1px solid #dbeafe;
                    border-radius: 4px;
                    padding: 1px 3px;
                    box-shadow: 0 1px 2px rgba(30, 64, 175, 0.06);
                    transition: background-color 0.2s ease, box-shadow 0.2s ease;
                }
                .highlight:hover {
                    background-color: #dbeafe;
                    box-shadow: 0 2px 4px rgba(30, 64, 175, 0.12);
                }
            `}</style>
            <div
                className="document-content"
                dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
        </div>
    );
}