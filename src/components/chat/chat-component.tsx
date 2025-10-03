"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/trpc/react";
import { ChatInput } from "./chat-input";
import { Streamdown } from "streamdown";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import dynamic from "next/dynamic";
import { TypingAnimation } from "./typing-animation";
import { FileChip } from "./file-chip";

const SourceViewer = dynamic(
  () => import("@/components/SourceViewer").then((mod) => mod.SourceViewer),
  { ssr: false }
);

interface ChatComponentProps {
  chatId?: string;
}

interface CitationData {
  citedText: string;
  pageNumber?: number;
  fileUrl: string;
  chunkId?: string;
  nonce: number;
}

type DisplayFile = {
  id: string;
  name: string;
  type: string;
  url?: string;
  supabasePath?: string;
  htmlContent?: string | null;
};

export function ChatComponent({ chatId }: ChatComponentProps) {
  const router = useRouter();
  const [citationData, setCitationData] = useState<CitationData | null>(null);
  const [fileContentMap, setFileContentMap] = useState<Map<string, string>>(new Map());
  const [immediateFiles, setImmediateFiles] = useState<DisplayFile[]>([]);

  const utils = api.useUtils();

  const { data: chatData } = api.chat.getById.useQuery(
    { id: chatId! },
    { enabled: !!chatId, refetchOnWindowFocus: false }
  );

  useEffect(() => {
    if (chatData?.messages) {
      const newMap = new Map<string, string>();
      const allFiles = [
        ...(chatData.messages.flatMap(m => m.messageFiles.map(mf => mf.file))),
        ...(chatData.messages.flatMap(m => m.messageSources.map(ms => ms.file))),
      ];

      const uniqueFiles = allFiles.filter((file, index, self) => file && index === self.findIndex((f) => f.id === file.id));

      uniqueFiles.forEach(file => {
        if (file.id && file.htmlContent) {
          newMap.set(file.id, file.htmlContent);
        }
      });
      setFileContentMap(newMap);
    }
  }, [chatData]);


  const { messages, status, sendMessage, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages, id: _id, body }) => ({
        body: {
          message: messages.at(-1)?.parts.find((part) => part.type === "text")?.text,
          chatId,
          ...body,
        },
      }),
    }),
    onData: (data) => {
      if (data.type === "data-chatId") {
        const newChatId = (data.data as { chatId: string }).chatId;
        if (newChatId !== chatId) {
          utils.chat.getById.prefetch({ id: newChatId }).then(() => {
            router.push(`/chat/${newChatId}`);
          }).catch();
        }
      }
    },
    onFinish: () => {
      void utils.chat.getById.invalidate();
    },
  });

  const isLoading = status === "submitted" || status === "streaming";

  const allChatFiles = useMemo(
    () =>
      chatData?.messages
        ?.flatMap((message) => message.messageFiles ?? [])
        ?.filter(
          (messageFile, index, self) =>
            index === self.findIndex((mf) => mf.file.id === messageFile.file.id)
        ) ?? [],
    [chatData?.messages]
  );

  useEffect(() => {
    if (chatData?.messages) {
      const uiMessages: UIMessage[] = chatData.messages.map((message) => ({
        id: message.id,
        role: message.role === "USER" ? "user" : "assistant",
        content: message.content,
        createdAt: message.createdAt,
        parts: [{ type: "text", text: message.content }],
      }));
      setMessages(uiMessages);
    }
  }, [chatData?.messages, setMessages]);

  const handleFilesChange = useCallback((files: DisplayFile[]) => {
    setImmediateFiles(files);
  }, []);

  useEffect(() => {
    if (allChatFiles.length > 0 && immediateFiles.length > 0) {
      setImmediateFiles([]);
    }
  }, [allChatFiles, immediateFiles]);

  const handleMessageSubmit = useCallback(
    async (messageText: string, fileIds?: string[]) => {
      if (!messageText.trim() || isLoading) return;
      await sendMessage({ text: messageText }, {
        body: {
          message: messageText,
          fileIds,
          chatId
        }
      });
    },
    [isLoading, sendMessage, chatId]
  );

  const sanitizeStreamedText = useCallback((text: string) => {
    if (!text) return text;

    let output = text;

    output = output.replace(/<sources>[\s\S]*?<\/sources>/gi, "");

    const openIdx = output.lastIndexOf("<citation");
    const closeIdx = output.lastIndexOf("</citation>");
    if (openIdx !== -1 && (closeIdx === -1 || closeIdx < openIdx)) {
      output = output.slice(0, openIdx);
    }

    return output;
  }, []);


  const handleCitationClick = useCallback(
    ({ messageId, citedText, pageNumber, fileId, chunkId }: { messageId: string; citedText: string; pageNumber: number; fileId: string; chunkId?: string; }) => {
      const message = chatData?.messages.find((msg) => msg.id === messageId);
      const fileSource = message?.messageSources.find((source) => source.file.id === fileId);

      if (fileSource && fileSource.file.htmlContent) {
        setCitationData({
          citedText,
          pageNumber,
          fileUrl: fileSource.file.htmlContent,
          chunkId: chunkId,
          nonce: Date.now(),
        });
        return;
      }

      const chatFile = allChatFiles.find((mf) => mf.file.id === fileId);
      if (chatFile && chatFile.file.htmlContent) {
        setCitationData({
          citedText,
          pageNumber,
          fileUrl: chatFile.file.htmlContent,
          chunkId: chunkId,
          nonce: Date.now(),
        });
        return;
      }

      const immediateFile = immediateFiles.find((file) => file.id === fileId);
      if (immediateFile && immediateFile.htmlContent) {
        setCitationData({
          citedText,
          pageNumber,
          fileUrl: immediateFile.htmlContent,
          chunkId: chunkId,
          nonce: Date.now(),
        });
        return;
      }

      const htmlContent = fileContentMap.get(fileId);
      if (htmlContent) {
        setCitationData({
          citedText,
          pageNumber,
          fileUrl: htmlContent,
          chunkId: chunkId,
          nonce: Date.now(),
        });
        return;
      }
    },
    [chatData?.messages, allChatFiles, immediateFiles, fileContentMap]
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
        <ResizablePanel defaultSize={citationData ? 55 : 100} minSize={30}>
          <div className="flex h-full min-h-0 flex-col">
            {(immediateFiles.length > 0 || allChatFiles.length > 0) && (
              <div className="px-4 pt-4 pb-2 flex-shrink-0">
                <div className="mx-auto flex max-w-4xl justify-end">
                  <div className="flex max-w-[80%] flex-wrap gap-2">
                    {immediateFiles.map((file) => (
                      <FileChip
                        key={`immediate-${file.id}`}
                        file={file}
                        onClick={() => {
                          const htmlContent = fileContentMap.get(file.id) || file.htmlContent;
                          if (htmlContent) {
                            setCitationData({
                              citedText: `Viewing ${file.name}`,
                              pageNumber: 1,
                              fileUrl: htmlContent,
                              nonce: Date.now(),
                            });
                          }
                        }}
                      />
                    ))}
                    {allChatFiles.map((messageFile) => (
                      <FileChip
                        key={`db-${messageFile.file.id}`}
                        file={messageFile.file}
                        onClick={() => {
                          const htmlContent = fileContentMap.get(messageFile.file.id) || messageFile.file.htmlContent;
                          if (htmlContent) {
                            setCitationData({
                              citedText: `Viewing ${messageFile.file.name}`,
                              pageNumber: 1,
                              fileUrl: htmlContent,
                              nonce: Date.now(),
                            });
                          }
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <ScrollArea className="flex-1 min-h-0 p-4">
              <div className="mx-auto max-w-4xl space-y-4 pb-4">
                <TooltipProvider delayDuration={100}>
                  {messages.map((message) => (
                    <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`rounded-lg px-4 py-2 ${message.role === "user" ? "bg-muted" : "bg-white"}`}>
                        <div className="prose prose-sm max-w-none leading-relaxed">
                          {message.parts?.filter((part) => part.type === "text").map((part, _index) => (
                            <Streamdown
                              key={_index}
                              components={{
                                // @ts-expect-error dynamic props
                                citation: ({ children, ...rest }: any) => (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <sup
                                        className="relative -top-1 mx-0.5 inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-blue-500 text-xs font-semibold text-white transition-colors hover:bg-blue-600 hover:text-white"
                                        onClick={() => handleCitationClick({
                                          messageId: message.id,
                                          citedText: rest["cited-text"],
                                          pageNumber: rest["file-page-number"],
                                          fileId: rest["file-id"],
                                          chunkId: rest["chunk-id"],
                                        })}
                                      >
                                        {children?.toString().replace(/[\[\]]/g, '')}
                                      </sup>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="max-w-xs">{rest["cited-text"]}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                ),
                              }}
                            >
                              {sanitizeStreamedText(part.text)}
                            </Streamdown>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </TooltipProvider>
                {isLoading && (
                  <div className="flex justify-start">
                    <TypingAnimation />
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="sticky bottom-0 left-0 right-0 px-4 pb-4 flex-shrink-0">
              <div className="mx-auto flex max-w-4xl justify-center">
                <div className="w-full">
                  <ChatInput
                    onSubmit={handleMessageSubmit}
                    disabled={isLoading}
                    onFilesChange={handleFilesChange}
                  />
                </div>
              </div>
            </div>
          </div>
        </ResizablePanel>
        {citationData && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={45} minSize={30}>
              <div className="flex h-full flex-col border-l">
                <div className="bg-muted/50 flex items-center justify-between border-b p-4">
                  <h2 className="text-sm font-medium">Source Document</h2>
                  <Button variant="ghost" size="sm" onClick={() => setCitationData(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex-1 overflow-auto">
                  <SourceViewer
                    htmlContent={citationData.fileUrl}
                    citedText={citationData.citedText}
                    highlightChunkId={citationData.chunkId}
                    refreshKey={citationData.nonce}
                  />
                </div>
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
