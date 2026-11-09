using System;
using UnityEngine;
using System.Runtime.InteropServices;

[Serializable] public class ImprovementProposal { public string id, text, author, status, createdAt; public int votes; public bool isOwn; }
[Serializable] public class ImprovementPermission { public string role, roundKey; public bool used; }
[Serializable] public class ImprovementBoard { public string storage, notice; public bool unavailable; public ImprovementPermission permission; public ImprovementProposal[] proposals; }
[Serializable] public class ImprovementRequest { public string type = "feedback", action, text, proposalId; }
[Serializable] public class ImprovementJoin { public string type = "join", name, feedbackKey; public int protocol = 2; }

public partial class OrbitGame
{
#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")] private static extern void OrbitFeedbackEditor(float x, float y, float width, float height, string draft);
    [DllImport("__Internal")] private static extern void OrbitFeedbackHide();
    [DllImport("__Internal")] private static extern string OrbitFeedbackIdentity(string previous);
    [DllImport("__Internal")] private static extern void OrbitOpenHistory();
#endif
    private bool improvementOpen;
    private string improvementDraft = "";
    private ImprovementBoard improvementBoard;
    private Vector2 improvementScroll;
    private float improvementNextPoll;
    private int improvementFinishedRound = -1;
    private GUIStyle improvementBody, improvementHeading, improvementNote, improvementButton, improvementInput, improvementCount;

    private string ImprovementKey
    {
        get
        {
            string key = PlayerPrefs.GetString("valley-improvement-key", "");
#if UNITY_WEBGL && !UNITY_EDITOR
            key = OrbitFeedbackIdentity(key);
#else
            if (key.Length != 64) key = Guid.NewGuid().ToString("N") + Guid.NewGuid().ToString("N");
#endif
            PlayerPrefs.SetString("valley-improvement-key", key); PlayerPrefs.Save(); return key;
        }
    }
    private void ReceiveImprovement(ImprovementBoard board)
    {
        if (board == null) return;
        if (board.unavailable && improvementBoard != null) { improvementBoard.notice = board.notice; return; }
        if (board.notice == "改善案を投稿しました") { improvementDraft = ""; PlayerPrefs.DeleteKey("valley-improvement-draft"); PlayerPrefs.Save(); }
        improvementBoard = board;
    }
    private void UpdateImprovements()
    {
        if (state != null && state.phase == "finished" && improvementFinishedRound != state.round)
        { improvementFinishedRound = state.round; CancelBowDraw(); Unlock(); }
        if (!improvementOpen) return;
        if (Input.GetKeyDown(KeyCode.Escape)) { CloseImprovements(); return; }
        if (connected && joined && Time.unscaledTime >= improvementNextPoll)
        {
            improvementNextPoll = Time.unscaledTime + 2;
            Send(JsonUtility.ToJson(new ImprovementRequest { action = "view" }));
        }
    }
    private void OpenImprovements(bool history)
    {
        if (history) { OpenImprovementHistory(); return; }
        improvementOpen = true; improvementNextPoll = 0;
        CancelBowDraw(); Unlock(); surveyResumeBlock = true;
#if UNITY_WEBGL && !UNITY_EDITOR
        WebGLInput.captureAllKeyboardInput = false;
#endif
    }
    private void CloseImprovements()
    {
        improvementOpen = false; surveyResumeBlock = true; GUIUtility.keyboardControl = 0;
        SaveImprovementDraft();
#if UNITY_WEBGL && !UNITY_EDITOR
        OrbitFeedbackHide(); WebGLInput.captureAllKeyboardInput = true;
#endif
    }
    private void OpenImprovementHistory()
    {
        HideImprovementEditor();
        SaveImprovementDraft();
        // Migrate the existing PlayerPrefs identity before leaving the game.
        _ = ImprovementKey;
#if UNITY_WEBGL && !UNITY_EDITOR
        OrbitOpenHistory();
#else
        Application.OpenURL("http://127.0.0.1:18087/history/");
#endif
    }
    private void SaveImprovementDraft()
    {
        PlayerPrefs.SetString("valley-improvement-draft", improvementDraft); PlayerPrefs.Save();
    }
    public void FeedbackDraftChanged(string value) { improvementDraft = value; }
    public void FeedbackClose(string unused) { CloseImprovements(); }
    private void HideImprovementEditor()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        OrbitFeedbackHide();
#endif
    }
    private void InitImprovements()
    {
        if (improvementBody != null) return;
        InitFieldbook();
        improvementDraft = PlayerPrefs.GetString("valley-improvement-draft", "");
        improvementBody = new GUIStyle(hudBody) { fontSize = 17, wordWrap = true, richText = false, alignment = TextAnchor.UpperLeft };
        improvementHeading = new GUIStyle(improvementBody) { fontSize = 27, fontStyle = FontStyle.Bold };
        improvementNote = new GUIStyle(improvementBody) { fontSize = 13 };
        improvementButton = new GUIStyle(improvementBody) { alignment = TextAnchor.MiddleCenter, fontSize = 16 };
        improvementCount = new GUIStyle(improvementHeading) { alignment = TextAnchor.MiddleCenter };
        improvementInput = new GUIStyle(GUI.skin.textArea) { font = font, fontSize = 18, wordWrap = true, richText = false, padding = new RectOffset(10, 10, 8, 8) };
        improvementBody.normal.textColor = improvementHeading.normal.textColor = improvementNote.normal.textColor = improvementButton.normal.textColor = GuiTint(FieldInk);
        improvementCount.normal.textColor = GuiTint(FieldInk);
        improvementInput.normal.textColor = improvementInput.focused.textColor = GuiTint(FieldInk);
    }
    private void ImprovementText(Rect rect, string value, GUIStyle style = null)
    {
        GUI.Label(rect, value ?? "", style ?? improvementBody);
    }
    private bool ImprovementButton(Rect rect, string label, bool enabled = true)
    {
        bool previous = GUI.enabled; GUI.enabled = enabled;
        DrawTint(rect, new Color(.13f, .18f, .17f, enabled ? .09f : .035f));
        bool clicked = GUI.Button(rect, label, improvementButton);
        GUI.enabled = previous; return clicked;
    }
    private void DrawImprovementBoard(float w, float h)
    {
        InitImprovements();
        DrawTint(new Rect(0, 0, w, h), new Color(.015f, .025f, .02f, .86f));
        float width = Mathf.Min(900, w - 40), x = (w - width) / 2, y = 24, height = h - 48;
        DrawTint(new Rect(x, y, width, height), new Color(.95f, .94f, .90f));
        ImprovementText(new Rect(x + 26, y + 20, width - 210, 40), "次の改善案", improvementHeading);
        if (ImprovementButton(new Rect(x + width - 126, y + 18, 100, 34), started ? "ゲームへ戻る" : "戻る")) CloseImprovements();
        if (ImprovementButton(new Rect(x + 26, y + 69, 160, 34), "提案・投票")) { improvementScroll = Vector2.zero; }
        if (ImprovementButton(new Rect(x + 194, y + 69, 180, 34), "これまでの変更")) OpenImprovementHistory();
        HudLine(new Vector2(x + 26, y + 116), new Vector2(x + width - 26, y + 116), FieldRule);
        DrawImprovementProposals(new Rect(x + 26, y + 132, width - 52, height - 158));
    }
    private void DrawImprovementProposals(Rect rect)
    {
        var permission = improvementBoard?.permission;
        bool winner = permission != null && permission.role == "winner";
        string hint = !joined ? "試合を終えると、勝者は改善案を1件、敗者は1票を送れます。"
            : permission == null ? "試合を終えると、勝者は改善案を1件、敗者は1票。同率首位も投稿できます。"
            : permission.used ? winner ? "この試合の改善案は投稿済みです。" : "この試合の投票は完了しました。"
            : winner ? "勝者の改善案。次の試合で変えてみたいことを教えてください。" : "気になる改善案へ1票。新しい案は投稿されるとここに届きます。";
        ImprovementText(new Rect(rect.x, rect.y, rect.width, 42), hint);
        float top = rect.y + 46;
        if (winner && !permission.used)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            if (Event.current.type == EventType.Repaint)
            {
                float scale = GUI.matrix.m00;
                OrbitFeedbackEditor(rect.x * scale / Screen.width, top * scale / Screen.height,
                    (rect.width - 126) * scale / Screen.width, 70 * scale / Screen.height, improvementDraft);
            }
#else
            improvementDraft = GUI.TextArea(new Rect(rect.x, top, rect.width - 126, 70), improvementDraft, 180, improvementInput);
#endif
            if (ImprovementButton(new Rect(rect.xMax - 114, top, 114, 70), "投稿する", improvementDraft.Trim().Length >= 3))
            {
                Send(JsonUtility.ToJson(new ImprovementRequest { action = "propose", text = improvementDraft }));
                improvementNextPoll = Time.unscaledTime + 2;
            }
            top += 82;
        }
        else HideImprovementEditor();
        ImprovementText(new Rect(rect.x, top, rect.width, 24), improvementBoard?.notice ?? "", improvementNote);
        top += 30;
        var proposals = improvementBoard?.proposals ?? new ImprovementProposal[0];
        var viewport = new Rect(rect.x, top, rect.width, Mathf.Max(50, rect.yMax - top - 44));
        var content = new Rect(0, 0, rect.width - 20, Mathf.Max(viewport.height, proposals.Length * 116));
        improvementScroll = GUI.BeginScrollView(viewport, improvementScroll, content);
        if (proposals.Length == 0) ImprovementText(new Rect(0, 8, content.width, 58), "まだ改善案はありません。\n勝者の投稿を待っています。", improvementNote);
        for (int i = 0; i < proposals.Length; i++)
        {
            var proposal = proposals[i]; float yy = i * 116;
            ImprovementText(new Rect(0, yy + 3, content.width - 126, 64), proposal.text);
            ImprovementText(new Rect(0, yy + 71, content.width - 126, 22), proposal.author + (proposal.isOwn ? "（自分）" : "") + " の提案　・　未実装", improvementNote);
            bool canVote = permission != null && permission.role == "voter" && !permission.used && !proposal.isOwn;
            if (canVote && ImprovementButton(new Rect(content.width - 110, yy + 11, 104, 62), proposal.votes + "票\n投票する"))
            {
                Send(JsonUtility.ToJson(new ImprovementRequest { action = "vote", proposalId = proposal.id }));
                improvementNextPoll = Time.unscaledTime + 2;
            }
            else if (!canVote)
            {
                ImprovementText(new Rect(content.width - 110, yy + 5, 104, 41), proposal.votes + "票", improvementCount);
                ImprovementText(new Rect(content.width - 110, yy + 49, 104, 26), proposal.isOwn ? "自分の案" : permission != null && permission.role == "voter" && permission.used ? "投票済み" : "受付中", improvementButton);
            }
            HudLine(new Vector2(0, yy + 106), new Vector2(content.width, yy + 106), FieldRule);
        }
        GUI.EndScrollView();
        string storage = improvementBoard == null ? "提案は参加後に読み込めます。" : improvementBoard.unavailable ? "いまは保存できません。少し待ってから再度お試しください。"
            : improvementBoard.storage == "memory" ? "この試遊の案と票は、サーバー再起動で消えます。" : "案と票は、次の試合にも引き継がれます。";
        ImprovementText(new Rect(rect.x, rect.yMax - 34, rect.width, 36), storage, improvementNote);
    }
}
