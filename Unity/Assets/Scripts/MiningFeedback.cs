using System;
using System.Collections.Generic;
using UnityEngine;

public partial class OrbitGame
{
    private const float SwingImpact = .16f;
    private const float SwingRecovery = .47f;
    private const float MeleeSwingSeconds = .30f;
    private float swingStarted = -10f;
    private float miningSwingStarted = -10f;
    private bool swingSent;
    private bool fastMeleeSwing;
    private float hitAt = -10f;
    private float feedbackUntil;
    private string feedback = "";
    private Color feedbackColor = Color.white;
    private AudioClip whooshSound, stoneSound, weakSound, breakSound, coinSound, hurtSound;
    private readonly List<MiningChip> chips = new List<MiningChip>();
    private Mesh chipMesh, billboardMesh;
    private Material dustMaterial, sparkMaterial;
    private MaterialPropertyBlock particleTint;

    private struct MiningChip
    {
        public Transform Mesh;
        public Vector3 Velocity;
        public float Expires, Age, StartSize;
        public MeshRenderer Renderer;
        public Color Tint;
        public bool Billboard, Spark;
    }

    private void InitMiningFeedback()
    {
        whooshSound = MakeImpactSound("Pick windup", .16f, 138, 0);
        stoneSound = Resources.Load<AudioClip>("MiningAudio/rock-hit") ?? MakeImpactSound("Stone and steel", .22f, 480, 1);
        weakSound = Resources.Load<AudioClip>("MiningAudio/weak-hit") ?? MakeImpactSound("Crystal strike", .24f, 1050, 1);
        breakSound = Resources.Load<AudioClip>("MiningAudio/rock-break") ?? MakeImpactSound("Shattered vein", .39f, 205, 2);
        coinSound = Resources.Load<AudioClip>("MiningAudio/deposit") ?? MakeImpactSound("Sale coins", .32f, 900, 3);
        hurtSound = MakeImpactSound("Bag struck", .19f, 155, 1);
        LoadMiningEventSounds();
    }

    private AudioClip MakeImpactSound(string label, float length, float frequency, int mode)
    {
        const int sampleRate = 22050;
        var data = new float[(int)(sampleRate * length)];
        var random = new System.Random(101 + mode);
        float filtered = 0;
        for (int i = 0; i < data.Length; i++)
        {
            float t = i / (float)sampleRate;
            float noise = (float)random.NextDouble() * 2 - 1;
            filtered = Mathf.Lerp(filtered, noise, .18f);
            float ring = Mathf.Sin(t * frequency * 6.283f) + .38f * Mathf.Sin(t * frequency * 15.1f);
            switch (mode)
            {
                case 0:
                    data[i] = filtered * Mathf.Pow(Mathf.Sin(Mathf.PI * t / length), 2) * .24f;
                    break;
                case 2:
                    float rubble = Mathf.Exp(-t * 13) + .55f * Mathf.Exp(-Mathf.Abs(t - .105f) * 46);
                    data[i] = (filtered * .7f + noise * .27f + ring * .13f) * rubble * .58f;
                    break;
                case 3:
                    float second = t - .095f;
                    data[i] = ring * Mathf.Exp(-t * 19) * .20f;
                    if (second >= 0)
                        data[i] += Mathf.Sin(second * frequency * 8.3f) * Mathf.Exp(-second * 15) * .16f;
                    break;
                default:
                    data[i] = noise * Mathf.Exp(-t * 76) * .42f + ring * Mathf.Exp(-t * 25) * .28f;
                    break;
            }
        }
        var clip = AudioClip.Create(label, data.Length, 1, sampleRate, false);
        clip.SetData(data, 0);
        return clip;
    }

    private void BeginSwing(bool immediate = false)
    {
        // Repeated entity attacks are immediate, but do not restart the hand before half its swing.
        if (immediate && Time.unscaledTime - swingStarted < MeleeSwingSeconds * .5f) return;
        if (!immediate && !MiningSwingReady()) return;
        swingStarted = Time.unscaledTime;
        fastMeleeSwing = immediate;
        if (!immediate) miningSwingStarted = swingStarted;
        swingSent = false;
        audioSource.PlayOneShot(whooshSound, .65f + .045f * renderedPickLevel);
    }

    private bool MiningSwingReady()
        => Time.unscaledTime - miningSwingStarted >= CurrentPickCooldown() + .06f;

    private bool ConsumeSwingImpact()
    {
        if (swingSent || Time.unscaledTime - swingStarted < SwingImpact)
            return false;
        swingSent = true;
        return true;
    }

    private void AnimatePick(float pace)
    {
        float age = Time.unscaledTime - swingStarted;
        float stride = Mathf.Sin(footPhase * .5f);
        float heel = Mathf.Abs(Mathf.Sin(footPhase));
        var rest = GearRest + new Vector3(stride * .013f, -heel * .012f, heel * .011f) * pace;
        var restAngle = GearRestAngle + new Vector3(heel * 1.4f, stride * 1.9f, stride * 2.8f) * pace;
        float running = Mathf.Clamp01((pace - 1) / .30f);
        rest += new Vector3(.013f, -.036f, -.015f) * running;
        restAngle += new Vector3(-5, -6, -8) * running;
        var wind = new Vector3(.435f, -.25f, .68f);
        var windAngle = new Vector3(-46, -39, 11);
        var contactAngle = new Vector3(25, 15, -47);
        var contact = new Vector3(.013f, -.017f, .88f) - Quaternion.Euler(contactAngle) * PickPoint;
        var position = rest;
        var angle = restAngle;
        const float windup = .086f;
        const float settle = .194f;
        if (fastMeleeSwing && age >= 0 && age < MeleeSwingSeconds)
        {
            float phase = Mathf.Clamp01(age / MeleeSwingSeconds);
            // The legacy six-tick swing moves forward quickly, then settles;
            // its quarter-cycle contact matches the immediate queued strike.
            float reach = Mathf.Sin(Mathf.Sqrt(phase) * Mathf.PI);
            position = Vector3.Lerp(rest, contact, reach);
            angle = Vector3.Lerp(restAngle, contactAngle, reach);
            position.x -= Mathf.Sin(phase * phase * Mathf.PI) * .026f;
        }
        else if (!fastMeleeSwing && age >= 0 && age < windup)
        {
            float blend = Mathf.SmoothStep(0, 1, age / windup);
            position = Vector3.Lerp(rest, wind, blend);
            angle = Vector3.Lerp(restAngle, windAngle, blend);
        }
        else if (!fastMeleeSwing && age >= windup && age < SwingImpact)
        {
            float blend = Mathf.Pow((age - windup) / (SwingImpact - windup), 1.7f);
            position = Vector3.Lerp(wind, contact, blend);
            angle = Vector3.Lerp(windAngle, contactAngle, blend);
        }
        else if (!fastMeleeSwing && age >= SwingImpact && age < SwingRecovery)
        {
            float release = Mathf.SmoothStep(0, 1, Mathf.Clamp01((age - settle) / (SwingRecovery - settle)));
            position = Vector3.Lerp(contact, rest, release);
            angle = Vector3.Lerp(contactAngle, restAngle, release);
            float impactAge = Time.unscaledTime - hitAt;
            if (impactAge >= 0 && impactAge < .10f)
            {
                float recoil = Mathf.Sin(impactAge / .10f * Mathf.PI) * (1 - release);
                position += new Vector3(.027f, .019f, -.068f) * recoil;
                angle.x -= 12 * recoil;
            }
        }
        float forgingAge = Time.unscaledTime - pickChangedAt;
        float swingDuration = fastMeleeSwing ? MeleeSwingSeconds : SwingRecovery;
        if (age >= swingDuration && forgingAge >= 0 && forgingAge < .72f)
        {
            float admire = Mathf.Sin(Mathf.PI * forgingAge / .72f);
            position += new Vector3(-.012f,.062f,-.025f) * admire;
            angle += new Vector3(-3,18,8) * admire;
        }
        float receiptAge=Time.unscaledTime-cargoReceivedAt;
        if(age>=swingDuration&&receiptAge>=0&&receiptAge<.36f)
        {
            float receive=Mathf.Sin(receiptAge/.36f*Mathf.PI);
            position+=new Vector3(-.008f,-.026f,-.012f)*receive;
            angle.z+=receive*3;
        }
        float lossAge=Time.unscaledTime-cargoLostAt;
        if(age>=swingDuration&&lossAge>=0&&lossAge<.34f)
        {
            float tug=Mathf.Sin(lossAge/.34f*Mathf.PI);
            position+=new Vector3(.018f,.009f,-.043f)*tug;
            angle.z-=tug*4;
        }
        float hurt = MeleeHandFlinch;
        position += new Vector3(.024f, -.034f, -.045f) * hurt;
        angle.z += hurt * 6;
        tool.localPosition = position;
        tool.localRotation = Quaternion.Euler(angle);
        if (soilStep != null && gravelStep != null)
        {
            // The movement update plays the selected clip on the following footfall.
            int step = Mathf.FloorToInt(footPhase / Mathf.PI);
            bool gravel=ValleyLandscape.OnHaulGravel(predicted.x,predicted.z);
            stepSound = gravel && step % 3 != 2 ? gravelStep : soilStep;
        }
    }

    private void EnsureMiningParticleAssets()
    {
        if (chipMesh == null)
        {
            Transform prototype = Chunk(transform, Vector3.zero, Vector3.one, stone, 41);
            chipMesh = prototype.GetComponent<MeshFilter>().sharedMesh;
            Destroy(prototype.gameObject);
            billboardMesh = new Mesh { name = "Soft impact billboard" };
            billboardMesh.vertices = new[] { new Vector3(-.5f, -.5f), new Vector3(.5f, -.5f),
                new Vector3(.5f, .5f), new Vector3(-.5f, .5f) };
            billboardMesh.uv = new[] { Vector2.zero, Vector2.right, Vector2.one, Vector2.up };
            billboardMesh.triangles = new[] { 0, 1, 2, 0, 2, 3 };
            particleTint = new MaterialPropertyBlock();
            dustMaterial = MakeParticleMaterial(false);
            sparkMaterial = MakeParticleMaterial(true);
        }
    }

    private void HitFeedback(Vector3 position, Material color, bool weak, bool broken, bool own, string kind)
    {
        if(skipFinalStrikeFeedback){if(own)hitAt=Time.unscaledTime;return;}
        if(own)hitAt=Time.unscaledTime;

        Vector3 towardsEye = (cam.transform.position - position).normalized;
        position += towardsEye * .07f;
        EnsureMiningParticleAssets();
        int count = feedbackSceneryChip ? 4 : broken ? feedbackGoldLayer==1?6:9 : weak ? 6 : 4;
        for (int i = 0; i < count; i++)
        {
            var velocity = UnityEngine.Random.insideUnitSphere * 1.5f + Vector3.up * 1.55f + towardsEye * .7f;
            AddChip(position, velocity, UnityEngine.Random.Range(.043f, feedbackSceneryChip ? .067f : .106f),
                .43f, i % 2 == 0 ? stone : color, Color.white, false, false);
        }
        for (int i = 0; i < (broken && feedbackGoldLayer!=1 && !feedbackSceneryChip ? 4 : 2); i++)
        {
            var velocity = UnityEngine.Random.insideUnitSphere * .42f + Vector3.up * .37f;
            var dust = new Color(.74f, .64f, .48f, broken ? .55f : .40f);
            AddChip(position + UnityEngine.Random.insideUnitSphere * .08f, velocity,
                .19f + i * .052f, .37f, dustMaterial, dust, true, false);
        }
        if (weak)
        {
            Color tint = Color.Lerp(color.color, Color.white, .72f);
            AddChip(position, Vector3.zero, .22f, .08f, sparkMaterial, tint, true, true);
        }
    }

    private Material MakeParticleMaterial(bool spark)
    {
        const int size = 48;
        var mask = new Texture2D(size, size, TextureFormat.RGBA32, false);
        mask.wrapMode = TextureWrapMode.Clamp;
        var texels = new Color[size * size];
        for (int y = 0; y < size; y++)
        for (int x = 0; x < size; x++)
        {
            float dx = 2 * (x + .5f) / size - 1;
            float dy = 2 * (y + .5f) / size - 1;
            float alpha;
            if (spark)
            {
                float cross = Mathf.Max(Mathf.Abs(dx) + 9 * Mathf.Abs(dy),
                    Mathf.Abs(dy) + 9 * Mathf.Abs(dx));
                float arms = Mathf.Min(Mathf.Abs(dx) + 9 * Mathf.Abs(dy),
                    Mathf.Abs(dy) + 9 * Mathf.Abs(dx));
                alpha = Mathf.Clamp01(1 - arms) * .93f + .12f * Mathf.Clamp01(1 - cross);
            }
            else
            {
                float radius = Mathf.Sqrt(dx * dx + dy * dy);
                float fringe = (Mathf.PerlinNoise(x * .12f, y * .12f) - .5f) * .25f;
                alpha = Mathf.Pow(Mathf.Clamp01(1 - radius + fringe), 1.7f);
            }
            texels[y * size + x] = new Color(1, 1, 1, Mathf.Clamp01(alpha));
        }
        mask.SetPixels(texels);
        mask.Apply(false, true);
        var material = new Material(Resources.Load<Shader>("MiningParticle"));
        material.mainTexture = mask;
        return material;
    }

    private void AddChip(Vector3 position, Vector3 velocity, float size, float life,
        Material material, Color tint, bool billboard, bool spark)
    {
        if (chips.Count >= 90) return;
        var go = new GameObject(billboard ? spark ? "Weak seam flash" : "Soft rock dust" : "Fractured ore");
        go.transform.position = position;
        go.transform.localScale = Vector3.one * size;
        go.transform.rotation = billboard ? cam.transform.rotation : UnityEngine.Random.rotation;
        go.AddComponent<MeshFilter>().sharedMesh = billboard ? billboardMesh : chipMesh;
        var renderer = go.AddComponent<MeshRenderer>();
        renderer.sharedMaterial = material;
        chips.Add(new MiningChip
        {
            Mesh = go.transform, Renderer = renderer, Velocity = velocity, Expires = Time.time + life,
            StartSize = size, Age = life, Tint = tint, Billboard = billboard, Spark = spark
        });
    }

    private void UpdateChips()
    {
        for (int i = chips.Count - 1; i >= 0; i--)
        {
            var chip = chips[i];
            float remaining = chip.Expires - Time.time;
            if (remaining <= 0)
            {
                Destroy(chip.Mesh.gameObject);
                chips.RemoveAt(i);
                continue;
            }
            float progress = 1 - remaining / chip.Age;
            if (chip.Billboard)
            {
                chip.Mesh.rotation = cam.transform.rotation;
                chip.Mesh.localScale = Vector3.one * chip.StartSize * (1 + progress * (chip.Spark ? 1.05f : 1.65f));
                var tint = chip.Tint;
                float fade = (1 - progress) * (1 - progress);
                tint.a *= fade * (chip.Spark ? 1 : Mathf.Clamp01(progress * 9));
                particleTint.SetColor("_Tint", tint);
                chip.Renderer.SetPropertyBlock(particleTint);
            }
            else
            {
                chip.Velocity += Vector3.down * 7f * Time.deltaTime;
                chip.Mesh.Rotate(110 * Time.deltaTime, 190 * Time.deltaTime, 0);
                chip.Mesh.localScale = Vector3.one * chip.StartSize * Mathf.Clamp01(remaining * 9);
                Vector3 p = chip.Mesh.position;
                if (p.y < ValleyLandscape.Height(p.x, p.z) + .035f && chip.Velocity.y < 0)
                    chip.Velocity = new Vector3(chip.Velocity.x * .55f, -chip.Velocity.y * .28f, chip.Velocity.z * .55f);
            }
            chip.Mesh.position += chip.Velocity * Time.deltaTime;
            chips[i] = chip;
        }
    }
    private void ShowFeedback(string message, Color color)
    {
        feedback = message;
        feedbackColor = color;
        feedbackUntil = Time.time + 1.8f;
    }
}
