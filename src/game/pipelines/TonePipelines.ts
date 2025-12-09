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
    // Deep Blue tint + high contrast + darken
    // Reduce Red/Green significantly, boost Blue
    vec3 night = vec3(color.r * 0.1, color.g * 0.2, color.b * 1.5);
    
    // Vignette-like darkness (simple multiplier)
    float brightness = 0.5;
    
    gl_FragColor = vec4(night * brightness, color.a);
}
`;

const toxicFragmentShader = `
precision mediump float;
uniform sampler2D uMainSampler;
varying vec2 outTexCoord;

void main(void) {
    vec4 color = texture2D(uMainSampler, outTexCoord);
    // Nuclear Green tint + high saturation
    // Crush Blue/Red, explode Green
    vec3 toxic = vec3(color.r * 0.0, color.g * 2.0, color.b * 0.0);
    
    // Add a sickly yellow tint to highlights
    if (color.r > 0.5) toxic.r += 0.5;
    
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
