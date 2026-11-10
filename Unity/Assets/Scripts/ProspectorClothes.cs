using UnityEngine;

public partial class OrbitGame
{
    // Muted cloth dyes, unrelated to rank, equipment, team or carried ore.
    private static readonly Color[] CoatDyes = {
        new Color(.56f,.63f,.46f), new Color(.34f,.48f,.60f),
        new Color(.64f,.42f,.25f), new Color(.69f,.65f,.55f),
        new Color(.25f,.49f,.43f), new Color(.77f,.57f,.28f),
        new Color(.59f,.32f,.28f), new Color(.72f,.69f,.57f)
    };
    private static readonly Color[] CollarDyes = {
        new Color(.80f,.71f,.52f), new Color(.64f,.30f,.18f),
        new Color(.68f,.55f,.28f), new Color(.45f,.54f,.40f),
        new Color(.30f,.42f,.53f), new Color(.60f,.40f,.20f),
        new Color(.77f,.75f,.65f), new Color(.32f,.36f,.34f)
    };

    private void ApplyProspectorClothes(Transform root, string name)
    {
        if (!root) return;
        // Explicit FNV-1a over UTF-16, never runtime GetHashCode/random state.
        // The server supplies unique display names, including same-name suffixes.
        uint hash = 2166136261;
        foreach (char letter in name ?? "旅人") hash = unchecked((hash ^ letter) * 16777619);
        Color coat = CoatDyes[(int)(hash % CoatDyes.Length)];
        Color collar = CollarDyes[(int)((hash >> 8) % CollarDyes.Length)];
        var properties = new MaterialPropertyBlock();
        foreach (var renderer in root.GetComponentsInChildren<MeshRenderer>(true))
        {
            bool jacketPart = renderer.sharedMaterial == jacket;
            bool collarPart = renderer.sharedMaterial == scarf || renderer.name == "Felt hatband";
            if (!jacketPart && !collarPart) continue;
            renderer.GetPropertyBlock(properties);
            properties.SetColor(BodyColorId, jacketPart ? coat : collar);
            renderer.SetPropertyBlock(properties);
        }
    }
}
