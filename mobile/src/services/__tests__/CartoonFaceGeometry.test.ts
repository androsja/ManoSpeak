import {buildCartoonFaceGeometry} from '../CartoonFaceGeometry';

const face = Array.from({length: 468}, () => [0.5, 0.5, 0] as [number, number, number]);
face[10] = [0.5, 0.2, 0]; face[152] = [0.5, 0.8, 0];
face[33] = [0.35, 0.4, 0]; face[133] = [0.43, 0.4, 0]; face[159] = [0.39, 0.38, 0]; face[145] = [0.39, 0.42, 0];
face[263] = [0.65, 0.4, 0]; face[362] = [0.57, 0.4, 0]; face[386] = [0.61, 0.38, 0]; face[374] = [0.61, 0.42, 0];
face[70] = [0.3, 0.32, 0]; face[107] = [0.42, 0.31, 0];
face[336] = [0.58, 0.31, 0]; face[300] = [0.7, 0.32, 0];
face[1] = [0.5, 0.5, 0]; face[61] = [0.4, 0.65, 0]; face[291] = [0.6, 0.65, 0];
face[13] = [0.5, 0.63, 0]; face[14] = [0.5, 0.68, 0];

describe('cartoon face geometry', () => {
  it('derives face features from known Face Mesh landmarks', () => {
    const geometry = buildCartoonFaceGeometry(face);
    expect(geometry?.mouthCenter).toEqual([0.5, 0.655, 0]);
    expect(geometry?.mouthOpening).toBeCloseTo(0.05);
    expect(geometry?.leftEyeOpening).toBeCloseTo(0.04);
  });

  it('withholds the face if a required captured feature is missing', () => {
    const incomplete = face.map(point => [...point] as [number, number, number]);
    incomplete[14] = [0, 0, 0];
    expect(buildCartoonFaceGeometry(incomplete)).toBeUndefined();
  });
});
