#if UNITY_EDITOR
using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Concurrent;
using UnityEngine;

public partial class OrbitGame
{
    private ClientWebSocket editorSocket;
    private readonly ConcurrentQueue<string> editorMessages = new ConcurrentQueue<string>();
    private readonly System.Collections.Generic.Queue<string> editorSends = new System.Collections.Generic.Queue<string>();
    private bool editorSending;
    private async void ConnectEditor()
    {
        editorSocket?.Dispose();
        var socket = editorSocket = new ClientWebSocket();
        try
        {
            await socket.ConnectAsync(new Uri("ws://127.0.0.1:18087/ws"), CancellationToken.None);
            if (socket != editorSocket) return;
            SocketOpened("");
            var buffer = new byte[262144];
            while (socket.State == WebSocketState.Open)
            {
                int length = 0; WebSocketReceiveResult result;
                do { result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer, length, buffer.Length - length), CancellationToken.None); length += result.Count; }
                while (!result.EndOfMessage);
                if (result.MessageType == WebSocketMessageType.Close) break;
                editorMessages.Enqueue(Encoding.UTF8.GetString(buffer, 0, length));
            }
            if (socket == editorSocket) SocketClosed("");
        }
        catch (Exception e) { if (socket == editorSocket) { Debug.LogWarning(e.Message); SocketClosed(""); } }
    }
    private async void SendEditor(string json)
    {
        editorSends.Enqueue(json);
        if (editorSending) return;
        editorSending = true;
        try
        {
            while (editorSends.Count > 0)
            {
                var bytes = Encoding.UTF8.GetBytes(editorSends.Dequeue());
                if (editorSocket?.State != WebSocketState.Open) { editorSends.Clear(); break; }
                await editorSocket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
            }
        }
        catch (Exception e) { Debug.LogWarning(e.Message); editorSends.Clear(); }
        finally { editorSending = false; }
    }
    private void PollEditor() { while (editorMessages.TryDequeue(out string message)) SocketMessage(message); }
    private void CloseEditorConnection() { editorSocket?.Dispose(); }
}
#endif
