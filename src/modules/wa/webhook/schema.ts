export type MessageReceived =  {
    id: string
    from: string
    to: string
    chatId: string
    body: string
    type: string
    timestamp: number
    fromMe: boolean
    isGroup: boolean
    kind: string
    isStatusBroadcast: boolean
    isLidSender: boolean
    contact: {
        pushName: string
        name: string
    }
}