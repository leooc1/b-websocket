import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';

interface Message {
  user: string;
  text: string;
  timestamp: Date;
}

interface Room {
  id: string;
  messages: Message[];
  users: Set<string>;
  createdAt: Date;
}

@WebSocketGateway(3001, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private rooms = new Map<string, Room>();

  handleConnection(client: Socket) {
    console.log(`Cliente conectado: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Cliente desconectado: ${client.id}`);
    const roomId = client.data.roomId;
    const username = client.data.username;

    if (roomId && this.rooms.has(roomId)) {
      const room = this.rooms.get(roomId);
      if (room) {
        room.users.delete(username);
        this.server.to(roomId).emit('roomUsers', Array.from(room.users));
        console.log(`Usuário ${username} removido da sala ${roomId}`);
      }
    }
  }

  @SubscribeMessage('createRoom')
  handleCreateRoom(
    client: Socket,
    data: { username: string },
    callback: (response: { success: boolean; roomId?: string; error?: string }) => void,
  ) {
    try {
      const roomId = randomUUID();
      const username = data.username || `Usuário ${Math.floor(Math.random() * 1000)}`;

      const room: Room = {
        id: roomId,
        messages: [],
        users: new Set([username]),
        createdAt: new Date(),
      };

      this.rooms.set(roomId, room);
      client.data.username = username;
      client.data.roomId = roomId;
      client.join(roomId);

      console.log(`Sala criada: ${roomId} por ${username}`);
      callback({ success: true, roomId });
    } catch (error) {
      console.error('Erro ao criar sala:', error);
      callback({ success: false, error: 'Erro ao criar sala' });
    }
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    client: Socket,
    data: { username: string; roomId: string },
    callback?: (response: { success: boolean; error?: string }) => void,
  ) {
    try {
      const { username, roomId } = data;

      if (!this.rooms.has(roomId)) {
        if (callback) {
          callback({ success: false, error: 'Sala não encontrada' });
        }
        return;
      }

      const room = this.rooms.get(roomId)!;
      room.users.add(username);
      client.data.username = username;
      client.data.roomId = roomId;
      client.join(roomId);

      // Envia histórico de mensagens para o novo cliente
      client.emit('messageHistory', room.messages);

      // Notifica todos na sala sobre a mudança de usuários
      this.server.to(roomId).emit('roomUsers', Array.from(room.users));

      console.log(`Usuário ${username} entrou na sala ${roomId}`);
      if (callback) {
        callback({ success: true });
      }
    } catch (error) {
      console.error('Erro ao entrar na sala:', error);
      if (callback) {
        callback({ success: false, error: 'Erro ao entrar na sala' });
      }
    }
  }

  @SubscribeMessage('sendMessage')
  handleSendMessage(client: Socket, data: { text: string; roomId: string }) {
    try {
      const { text, roomId } = data;
      const room = this.rooms.get(roomId);

      if (!room) {
        console.error(`Sala ${roomId} não encontrada`);
        return;
      }

      const message: Message = {
        user: client.data.username || 'Anônimo',
        text,
        timestamp: new Date(),
      };

      room.messages.push(message);

      // Limita o histórico a 50 mensagens por sala
      if (room.messages.length > 50) {
        room.messages.shift();
      }

      // Envia a mensagem apenas para clientes da sala
      this.server.to(roomId).emit('newMessage', message);
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
    }
  }

  @SubscribeMessage('getMessages')
  handleGetMessages(client: Socket, data: { roomId: string }) {
    try {
      const room = this.rooms.get(data.roomId);
      if (room) {
        client.emit('messageHistory', room.messages);
      }
    } catch (error) {
      console.error('Erro ao obter mensagens:', error);
    }
  }
}
