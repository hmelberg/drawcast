# Attribution

The anatomy atlas (`atlas-body.json`, `atlas-skeleton.json`,
`atlas-viscera.json`) is derived from **BodyParts3D**:

> BodyParts3D, © The Database Center for Life Science licensed under
> CC Attribution-Share Alike 2.1 Japan

- Data: BodyParts3D 3.0 (20110915), obtained via the GitHub mirror
  https://github.com/Kevin-Mattheus-Moerman/BodyParts3D
- Paper: Mitsuhashi N, Fujieda K, Tamura T, Kawamoto S, Takagi T, Okubo K.
  BodyParts3D: 3D structure database for anatomical concepts.
  Nucleic Acids Res. 2009;37(Database issue):D782-5. doi:10.1093/nar/gkn613
- Archive: doi:10.18908/lsdba.nbdc00837-000

Each part's silhouette is the frontal projection of the corresponding
FMA-identified mesh (or the union of a composite's element meshes),
rasterised and contoured by `scripts/build-anatomy-atlas.mjs`. The single
exception is `uterus`, which has no mesh in this male dataset and is a
schematic shape (`source: "authored"`).
