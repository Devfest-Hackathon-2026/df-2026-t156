using UnityEngine;

public static partial class ValleyLandscape
{
    static void QuarriedCrown(MeshFilter filter,Vector3 origin,float radius,float height)
    {
        // The scan's tall irregular peak can leave empty air around a valid
        // weak sphere. A low mineral lip meets that sphere just above the body
        // cylinder's cap, so the invisible cap cannot intercept a ray aimed at
        // the visible fracture first. Footprint/physics remain authoritative;
        // world cover rocks retain the untouched scan.
        var mesh=UnityEngine.Object.Instantiate(filter.sharedMesh);
        mesh.name="Quarried scan with a continuous mineral crown";
        var vertices=mesh.vertices;
        for(int i=0;i<vertices.Length;i++)
        {
            Vector3 world=filter.transform.TransformPoint(vertices[i]);
            Vector3 local=world-origin;
            if(local.y<height*.42f)continue;
            float distance=new Vector2(local.x,local.z).magnitude;
            float blend=1-Mathf.SmoothStep(0,1,(distance-radius*.62f)/(radius*.31f));
            float face=height+.025f+Noise(local.x*7.1f,local.z*7.1f)*.035f;
            local.y=Mathf.Lerp(local.y,Mathf.Max(local.y,face),blend);
            vertices[i]=filter.transform.InverseTransformPoint(origin+local);
        }
        mesh.vertices=vertices;
        mesh.RecalculateNormals();mesh.RecalculateTangents();mesh.RecalculateBounds();
        filter.sharedMesh=mesh;
    }
}
