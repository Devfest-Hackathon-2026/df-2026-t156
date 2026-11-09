using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using UnityEngine;

public partial class OrbitGame : MonoBehaviour {
#if UNITY_WEBGL && !UNITY_EDITOR
 [DllImport("__Internal")] static extern void OrbitConnect(string target);
 [DllImport("__Internal")] static extern void OrbitSend(string json);
 [DllImport("__Internal")] static extern void OrbitPoll();

 [DllImport("__Internal")] static extern void OrbitRelease();
 [DllImport("__Internal")] static extern float OrbitReadLookX();
 [DllImport("__Internal")] static extern float OrbitReadLookY();
#endif
 class Walker {public Transform root,body,leftArm,rightArm,leftLeg,rightLeg,leftElbow,rightElbow,leftKnee,rightKnee,leftBoot,rightBoot;public OrbitPlayer data;public Vector3 previous;public float step,cut,lastGearStep,gearPace,renderTime;public readonly RemotePlayerTrack poses=new RemotePlayerTrack();}
 readonly Dictionary<string,Walker> walkers=new Dictionary<string,Walker>();
 ClientValleyData valley;bool focused=true;Camera cam; Transform tool;Material cloth,skin,wood,metal,ore,ropeMat,leather,stone;Font font;Texture2D pixel;OrbitState state;string localId="",nameInput="旅人",status="";bool started,joined,connected,locked,hasLocal;float yaw,pitch=5,nextSend,footPhase;Vector3 predicted=new Vector3(0,0,-12);GUIStyle title,text,small,button,bold;AudioSource audioSource;AudioClip stepSound;
 [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]static void Boot(){if(FindObjectOfType<OrbitGame>()==null)new GameObject("OrbitClient").AddComponent<OrbitGame>();}
 void Awake(){gameObject.name="OrbitClient";Application.targetFrameRate=60;QualitySettings.antiAliasing=2;ValleyLandscape.Build();BuildClient();}
 Material Material(Color c){var m=new Material(Resources.Load<Shader>("OrbitLit"));m.color=c;return m;}
 void BuildClient(){valley=JsonUtility.FromJson<ClientValleyData>(Resources.Load<TextAsset>("valley").text);
  stone=Material(new Color(.88f,.85f,.77f));stone.SetTexture("_MainTex",Resources.Load<Texture2D>("Valley/Rock"));cloth=Material(new Color(.22f,.36f,.27f));skin=Material(new Color(.73f,.5f,.33f));wood=Material(new Color(.48f,.35f,.21f));wood.SetTexture("_MainTex",Resources.Load<Texture2D>("Valley/Wood"));metal=Material(new Color(.65f,.69f,.67f));ore=Material(new Color(1,.62f,.07f));ore.SetColor("_EmissionColor",new Color(.24f,.11f,0));leather=Material(new Color(.34f,.22f,.12f));ropeMat=new Material(Resources.Load<Shader>("OrbitLine"));
  cam=new GameObject("WalkingCamera").AddComponent<Camera>();cam.clearFlags=CameraClearFlags.Skybox;cam.backgroundColor=new Color(.63f,.77f,.85f);cam.fieldOfView=72;cam.nearClipPlane=.045f;cam.farClipPlane=350;cam.transform.position=new Vector3(0,ValleyLandscape.Height(0,-12)+1.62f,-12);cam.transform.rotation=Quaternion.Euler(4,0,0);cam.gameObject.AddComponent<AudioListener>();
  BuildProspectorGear();
  font=Resources.Load<Font>("NotoSansJP-Regular");if(font==null)font=Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");pixel=Texture2D.whiteTexture;audioSource=gameObject.AddComponent<AudioSource>();stepSound=Resources.Load<AudioClip>("MiningAudio/footstep-gravel") ?? Tone("Footstep",.07f,105,.05f);InitMiningFeedback(); InitMiningWorld();
 }
 AudioClip Tone(string label,float duration,float frequency,float volume){int n=(int)(44100*duration);var data=new float[n];var random=new System.Random(29);for(int i=0;i<n;i++){float t=i/44100f;data[i]=(Mathf.Sin(t*frequency*Mathf.PI*2)*.6f+((float)random.NextDouble()*2-1)*.4f)*Mathf.Exp(-t*28)*volume;}var clip=AudioClip.Create(label,n,1,44100,false);clip.SetData(data,0);return clip;}
 Transform Part(Transform parent,string label,Vector3 position,Vector3 size,Material mat,int sides=8){var go=new GameObject(label);go.transform.SetParent(parent,false);go.transform.localPosition=position;var vertices=new List<Vector3>();var triangles=new List<int>();var uv=new List<Vector2>();for(int ring=0;ring<2;ring++)for(int i=0;i<sides;i++){float a=i*Mathf.PI*2/sides;vertices.Add(new Vector3(Mathf.Cos(a+(sides==4?Mathf.PI*.25f:0))*size.x*(sides==4?.70710678f:.5f),(ring-.5f)*size.y,Mathf.Sin(a+(sides==4?Mathf.PI*.25f:0))*size.z*(sides==4?.70710678f:.5f)));uv.Add(new Vector2(i/(float)sides,ring));}uv.Add(new Vector2(.5f,.5f));uv.Add(new Vector2(.5f,.5f));vertices.Add(new Vector3(0,-size.y*.5f,0));vertices.Add(new Vector3(0,size.y*.5f,0));for(int i=0;i<sides;i++){int j=(i+1)%sides;triangles.AddRange(new[]{i,i+sides,j+sides,i,j+sides,j,sides*2,i,j,sides*2+1,j+sides,i+sides});}var mesh=new Mesh();mesh.SetVertices(vertices);mesh.SetUVs(0,uv);mesh.SetTriangles(triangles,0);mesh.RecalculateNormals();go.AddComponent<MeshFilter>().sharedMesh=mesh;go.AddComponent<MeshRenderer>().sharedMaterial=mat;return go.transform;}
 Transform Chunk(Transform parent,Vector3 position,Vector3 scale,Material material,int seed){float g=(1+Mathf.Sqrt(5))/2;var points=new[]{new Vector3(-1,g,0),new Vector3(1,g,0),new Vector3(-1,-g,0),new Vector3(1,-g,0),new Vector3(0,-1,g),new Vector3(0,1,g),new Vector3(0,-1,-g),new Vector3(0,1,-g),new Vector3(g,0,-1),new Vector3(g,0,1),new Vector3(-g,0,-1),new Vector3(-g,0,1)};var faces=new[]{0,11,5,0,5,1,0,1,7,0,7,10,0,10,11,1,5,9,5,11,4,11,10,2,10,7,6,7,1,8,3,9,4,3,4,2,3,2,6,3,6,8,3,8,9,4,9,5,2,4,11,6,2,10,8,6,7,9,8,1};var rng=new System.Random(seed);for(int i=0;i<points.Length;i++)points[i]=Vector3.Scale(points[i].normalized*(.82f+(float)rng.NextDouble()*.25f),scale)*.65f;var vs=new Vector3[faces.Length];var uv=new Vector2[faces.Length];var ids=new int[faces.Length];for(int i=0;i<faces.Length;i++){vs[i]=points[faces[i]];uv[i]=new Vector2(vs[i].x*2+.5f,vs[i].y*2+.5f);ids[i]=i;}var mesh=new Mesh();mesh.vertices=vs;mesh.uv=uv;mesh.triangles=ids;mesh.RecalculateNormals();var go=new GameObject("Hand-cut mineral facets");go.transform.SetParent(parent,false);go.transform.localPosition=position;go.AddComponent<MeshFilter>().sharedMesh=mesh;go.AddComponent<MeshRenderer>().sharedMaterial=material;return go.transform;}
 LineRenderer Line(Vector3[] points,Color c,float width){var l=new GameObject("Mineral seam").AddComponent<LineRenderer>();l.sharedMaterial=ropeMat;l.startColor=l.endColor=c;l.startWidth=l.endWidth=width;l.positionCount=points.Length;l.SetPositions(points);return l;}
 void StartGame(){started=true;status="接続中…";Connect();Lock();}
 void Connect(){
#if UNITY_WEBGL && !UNITY_EDITOR
 OrbitConnect(gameObject.name);
#elif UNITY_EDITOR
 ConnectEditor();
#else
 status="ブラウザ版を開いてください";
#endif
 }
 void Send(string json){
#if UNITY_WEBGL && !UNITY_EDITOR
 OrbitSend(json);
#elif UNITY_EDITOR
 SendEditor(json);
#endif
 }
 void Lock(){
#if UNITY_WEBGL && !UNITY_EDITOR
 // WebGL acquires pointer lock synchronously on the browser canvas pointerdown.
#else
 locked=true;Cursor.lockState=CursorLockMode.Locked;Cursor.visible=false;
#endif
 }
 void Unlock(){locked=false;
#if UNITY_WEBGL && !UNITY_EDITOR
 OrbitRelease();
#else
 Cursor.lockState=CursorLockMode.None;Cursor.visible=true;
#endif
 }
 public void PointerChanged(string value)
 {
     bool captured = value == "1";
     if (locked && !captured) CancelBowDraw();
     locked = captured;
     if (captured) { pointerLockUnavailable = false; pointerAcquireBlocked = false; }
 }
 void OnApplicationFocus(bool value){focused=value;if(!value&&started)Unlock();}
 public void SocketOpened(string unused){connected=true;Send(JsonUtility.ToJson(new ImprovementJoin {name=nameInput,feedbackKey=ImprovementKey}));}
 public void SocketClosed(string reason){connected=false;joined=false;status="接続が切れました　Rで再接続";Unlock();}
 public void SocketMessage(string json){try{var s=JsonUtility.FromJson<OrbitState>(json);if(s.type=="feedback"){ReceiveImprovement(s.feedback);return;}if(s.type=="welcome"){localId=s.id;joined=true;hasLocal=false;ResetNetworkSession();return;}if(s.type=="state"){state=s;Apply(s);}if(s.type=="frame")ReceiveNetworkFrame(s);}catch(Exception e){Debug.LogWarning(e.Message);}}
 void Styles(){if(title!=null)return;title=new GUIStyle{font=font,fontSize=36,fontStyle=FontStyle.Bold,normal={textColor=new Color(.98f,.97f,.89f)}};text=new GUIStyle{font=font,fontSize=18,normal={textColor=new Color(.96f,.96f,.9f)}};small=new GUIStyle(text){fontSize=14};bold=new GUIStyle(text){fontStyle=FontStyle.Bold,fontSize=23};button=new GUIStyle(GUI.skin.button){font=font,fontSize=20};}
 void Panel(float x,float y,float w,float h,float alpha=.83f){GUI.color=new Color(.10f,.16f,.13f,alpha);GUI.DrawTexture(new Rect(x,y,w,h),pixel);GUI.color=Color.white;}
 void Text(float x,float y,string value,GUIStyle style,float width=800){var tint=GUI.color;GUI.color=new Color(.02f,.025f,.02f,.88f);GUI.Label(new Rect(x+1,y+1,width,140),value,style);GUI.color=tint;GUI.Label(new Rect(x,y,width,140),value,style);}
}
