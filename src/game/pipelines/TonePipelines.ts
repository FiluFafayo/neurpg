import Phaser from 'phaser';

const sepiaFragmentShader = `
precision mediump float;
uniform sampler2D uMainSampler;
varying vec2 outTexCoord;

void main(void) {
    vec4 color = texture2D(uMainSampler, outTexCoord);
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    vec3 sepia = vec3(gray * 1.2, gray * 1.0, gray * 0.8);
    gl_FragColor = vec4(sepia, color.a);
}
`;

const nightFragmentShader = `
precision mediump float;
uniform sampler2D uMainSampler;
varying vec2 outTexCoord;

void main(void) {
    vec4 color = texture2D(uMainSampler, outTexCoord);
    // Blue tint + darken
    vec3 night = vec3(color.r * 0.4, color.g * 0.4, color.b * 1.0);
    gl_FragColor = vec4(night * 0.7, color.a);
}
`;

const toxicFragmentShader = `
precision mediump float;
uniform sampler2D uMainSampler;
varying vec2 outTexCoord;

void main(void) {
    vec4 color = texture2D(uMainSampler, outTexCoord);
    // Green tint + high contrast
    vec3 toxic = vec3(color.r * 0.2, color.g * 1.5, color.b * 0.2);
    gl_FragColor = vec4(toxic, color.a);
}
`;

export class SepiaPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
    constructor(game: Phaser.Game) {
        super({
            game,
            name: 'SepiaPipeline',
            fragShader: sepiaFragmentShader
        });
    }
}

export class NightPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
    constructor(game: Phaser.Game) {
        super({
            game,
            name: 'NightPipeline',
            fragShader: nightFragmentShader
        });
    }
}

export class ToxicPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
    constructor(game: Phaser.Game) {
        super({
            game,
            name: 'ToxicPipeline',
            fragShader: toxicFragmentShader
        });
    }
}
