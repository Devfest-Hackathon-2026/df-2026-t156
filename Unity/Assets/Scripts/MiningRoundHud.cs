using UnityEngine;

public partial class OrbitGame
{
    private int enteredRound = -1;
    private string enteredPlayerId = "";
    private bool enteredDuringRound;
    private float lateEntryHintUntil;

    private void UpdateEntryTiming(OrbitState snapshot)
    {
        if (self == null) return;
        if (enteredPlayerId != self.id)
        {
            enteredPlayerId = self.id;
            enteredRound = -1;
        }
        if (enteredRound == snapshot.round) return;
        enteredDuringRound = enteredRound < 0 && snapshot.phase == "playing" && self.joinedLate;
        enteredRound = snapshot.round;
        lateEntryHintUntil = enteredDuringRound ? Time.unscaledTime + 8 : 0;
    }

    private void DrawLateEntryHint()
    {
        if (enteredDuringRound && Time.unscaledTime < lateEntryHintUntil)
            HudTag(158, 110, "途中参加", hudSmall, HudGold);
    }

    private void DrawFieldSettlement(float w, float h)
    {
        InitFieldbook();
        var rows = state.standings ?? new OrbitStanding[0];
        int mine = System.Array.FindIndex(rows, row => row.id == localId);
        var own = mine >= 0 ? rows[mine] : null;
        int count = Mathf.Min(8, rows.Length);
        const float width = 820, rowHeight = 55;
        float height = 110 + Mathf.Max(1, count) * rowHeight + 70;
        float x = (w - width) / 2, y = (h - height) / 2;
        DrawTint(new Rect(0, 0, w, h), new Color(.02f, .03f, .03f, .80f));
        HudLabel(x, y, "結果", fieldHeading, FieldWhite, 350);
        HudRight(x + width, y + 5, "次の試合 " + Mathf.Max(0, Mathf.CeilToInt(state.resultTimeLeft)) + "秒", fieldSmall, FieldQuiet);
        HudLabel(x, y + 63, "順位", fieldSmall, FieldQuiet, 85);
        HudLabel(x + 110, y + 63, "名前", fieldSmall, FieldQuiet, 440);
        HudRight(x + width, y + 63, "残高（点）", fieldSmall, FieldWhite);
        HudLine(new Vector2(x, y + 91), new Vector2(x + width, y + 91), new Color(1, 1, 1, .20f));
        for (int i = 0; i < count; i++)
        {
            var row = rows[i];
            float yy = y + 105 + i * rowHeight;
            bool isMine = row.id == localId, winner = row.rank == 1;
            if (isMine) DrawTint(new Rect(x - 14, yy - 4, 3, 39), FieldWhite);
            HudLabel(x, yy + 1, (IsStandingTied(row, rows) ? "同率" : "") + row.rank + "位", winner ? hudBody : fieldSmall,
                winner ? FieldWhite : FieldQuiet, 95);
            string name = ResultName(row.name) + (isMine ? "（自分）" : row.bot ? "（BOT）" : "");
            HudLabel(x + 110, yy - 2, name, winner ? fieldHeading : isMine ? fieldOwnName : hudBody, FieldWhite, 540);
            HudRight(x + width, yy - 4, row.score.ToString(), winner ? fieldHeading : hudNumber, FieldWhite);
        }
        if (count == 0) HudLabel(x + 110, y + 108, "次の試合から参加", hudBody, FieldQuiet, 500);
        float footer = y + height - 45;
        if (own != null)
        {
            HudLabel(x, footer, "売上 " + own.grossSales + "　− 購入 " + own.investmentSpent, fieldSmall, FieldQuiet, 470);
            if (own.inventoryCount > 0) HudRight(x + width, footer, "未売却 " + own.inventoryCount + "個", fieldSmall, FieldQuiet);
        }
    }



    private static bool IsStandingTied(OrbitStanding own, OrbitStanding[] rows)
        => System.Array.Exists(rows, row => row.id != own.id && row.rank == own.rank);



    private static string ResultName(string name)
    {
        if (string.IsNullOrEmpty(name)) return "旅人";
        if (name.Length <= 12) return name;
        int suffix = name.LastIndexOf(' ');
        if (suffix > 0 && name.Length - suffix <= 4)
            return name.Substring(0, 8) + "…" + name.Substring(suffix);
        return name.Substring(0, 11) + "…";
    }
}
