/**
 * Telegram client for monitoring personal account messages
 */

import { TelegramClient as TelegramApi, sessions } from 'telegram';
const { StringSession } = sessions;
import { TelegramConfig, RawTelegramMessage } from '../types';
import { getLogger, logApiError } from '../utils/logger';

export class TelegramClient {
  private client: TelegramApi | null = null;
  private config: TelegramConfig;
  private messageHandlers: Array<(message: RawTelegramMessage) => void> = [];
  private isConnected = false;

  constructor(config: TelegramConfig) {
    this.config = config;
  }

  /**
   * Initialize and connect to Telegram
   */
  async connect(): Promise<void> {
    try {
      const logger = getLogger();
      logger.info('Initializing Telegram client...');

      // Create session
      const session = new StringSession(this.config.sessionString || '');
      
      // Initialize client
      this.client = new TelegramApi(session, this.config.apiId, this.config.apiHash, {
        connectionRetries: 5,
        retryDelay: 5000
      });

      // Connect to Telegram
      await this.client.start({
        phoneNumber: async () => {
          // This will be called if no session string is provided
          throw new Error('Session string required. Please provide TELEGRAM_SESSION_STRING in environment variables.');
        },
        password: async () => {
          throw new Error('Two-factor authentication not supported in automated mode.');
        },
        phoneCode: async () => {
          throw new Error('Phone code verification not supported in automated mode.');
        },
        onError: (err: Error) => {
          logApiError('telegram', err);
        }
      });

      this.isConnected = true;
      logger.info('Telegram client connected successfully');

      // Set up message handler
      this.setupMessageHandler();

    } catch (error) {
      logApiError('telegram', error as Error, { action: 'connect' });
      throw error;
    }
  }

  /**
   * Set up message event handler
   */
  private setupMessageHandler(): void {
    if (!this.client) {
      throw new Error('Telegram client not initialized');
    }

    this.client.addEventHandler(async (event: any) => {
      try {
        // Log ALL events for debugging
        getLogger().debug('Received Telegram event', {
          eventType: event.className,
          eventKeys: Object.keys(event)
        });

        // Handle multiple message event types:
        // - UpdateNewMessage: groups and channels (older format)
        // - UpdateNewChannelMessage: channel messages (new format)
        // - UpdateShortMessage: private direct messages
        let message: any = null;

        if (event.className === 'UpdateNewMessage' || event.className === 'UpdateNewChannelMessage') {
          message = event.message;
        } else if (event.className === 'UpdateShortMessage') {
          // For short messages (private chats), we need to construct a message-like object
          message = {
            message: event.message,
            id: event.id,
            chatId: event.userId,
            date: event.date,
            fromId: event.userId,
            peerId: event.userId,
            getChat: async () => {
              // For private messages, get the user entity
              try {
                const user = await this.client!.getEntity(event.userId);
                return user;
              } catch (error) {
                getLogger().warn('Could not get user entity for UpdateShortMessage', {
                  userId: event.userId,
                  error: error instanceof Error ? error.message : 'Unknown'
                });
                return null;
              }
            }
          };
        }

        if (message) {

          // Check if message is from our target signal source
          let chat = await message.getChat();

          // For channel messages, getChat() might return null, so we need to get entity from peerId
          if (!chat && message.peerId) {
            try {
              chat = await this.client!.getEntity(message.peerId);
              getLogger().debug('Got chat entity from peerId', {
                peerId: message.peerId?.toString()
              });
            } catch (error) {
              getLogger().warn('Could not get entity from peerId', {
                peerId: message.peerId?.toString(),
                error: error instanceof Error ? error.message : 'Unknown'
              });
            }
          }

          const chatUsername = chat?.username;
          const chatTitle = (chat as any)?.title;
          const chatId = message.chatId;
          const fromId = message.fromId;
          const peerId = message.peerId;

          // Debug logging - log ALL incoming messages with extensive details
          getLogger().info('Received Telegram message', {
            chatUsername,
            chatTitle,
            chatId: chatId?.toString(),
            fromId: fromId?.toString(),
            peerId: peerId?.toString(),
            expectedSource: this.config.signalSource.replace('@', ''),
            messagePreview: message.message?.substring(0, 100),
            fullChatObject: chat ? JSON.stringify(chat).substring(0, 200) : 'null'
          });

          // Only process messages from the specified signal source
          if (chatUsername && chatUsername === this.config.signalSource.replace('@', '')) {
            getLogger().info('Message matches expected source, processing...');
            const rawMessage: RawTelegramMessage = {
              text: message.message || '',
              chatId: Number(message.chatId),
              messageId: message.id,
              date: new Date(message.date * 1000),
              fromBot: message.fromId?.className === 'PeerUser',
              senderUsername: chatUsername
            };

            // Notify all registered handlers
            this.messageHandlers.forEach(handler => {
              try {
                handler(rawMessage);
              } catch (error) {
                logApiError('telegram', error as Error, {
                  action: 'message_handler',
                  messageId: rawMessage.messageId
                });
              }
            });
          } else {
            getLogger().warn('Message does NOT match expected source', {
              received: chatUsername,
              expected: this.config.signalSource.replace('@', '')
            });
          }
        } // end if (message)
      } catch (error) {
        logApiError('telegram', error as Error, { action: 'message_event' });
      }
    });
  }

  /**
   * Register a message handler
   */
  onMessage(handler: (message: RawTelegramMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Remove a message handler
   */
  removeMessageHandler(handler: (message: RawTelegramMessage) => void): void {
    const index = this.messageHandlers.indexOf(handler);
    if (index > -1) {
      this.messageHandlers.splice(index, 1);
    }
  }

  /**
   * Get chat information
   */
  async getChatInfo(username: string): Promise<unknown> {
    if (!this.client) {
      throw new Error('Telegram client not connected');
    }

    try {
      const entity = await this.client.getEntity(username);
      return entity;
    } catch (error) {
      logApiError('telegram', error as Error, { 
        action: 'get_chat_info',
        username 
      });
      throw error;
    }
  }

  /**
   * Check connection status
   */
  isClientConnected(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * Disconnect from Telegram
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.disconnect();
        this.isConnected = false;
        getLogger().info('Telegram client disconnected');
      } catch (error) {
        logApiError('telegram', error as Error, { action: 'disconnect' });
      }
    }
  }

  /**
   * Get session string for future connections
   */
  getSessionString(): string {
    if (!this.client) {
      throw new Error('Telegram client not initialized');
    }
    return (this.client.session as any).save() as string;
  }

  /**
   * Send a test message to verify connection (for debugging)
   */
  async sendTestMessage(chatId: string, message: string): Promise<void> {
    if (!this.client) {
      throw new Error('Telegram client not connected');
    }

    try {
      await this.client.sendMessage(chatId, { message });
      getLogger().info('Test message sent successfully', { chatId, message });
    } catch (error) {
      logApiError('telegram', error as Error, { 
        action: 'send_test_message',
        chatId 
      });
      throw error;
    }
  }
}
