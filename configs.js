export const filterConfigs = [
    {
        id: "original",
        name: "Original",
        lut: null,
        enableLUT: false,
        chromaKeys: [],
        colorCorrections: []
    },
    {
        id: "blue",
        name: "Blue",
        lut: "LUTs/blue-isolated.png",
        enableLUT: true,
        chromaKeys: [],
        colorCorrections: []
    },
    {
        id: "red",
        name: "Red",
        lut: "LUTs/red-isolated.png",
        enableLUT: true,
        chromaKeys: [],
        colorCorrections: [
            {
            saturation: 2.4
            }
        ]
    },
    {
        id: "green",
        name: "Green",
        lut: "LUTs/green-isolated.png",
        enableLUT: true,
        chromaKeys: [],
        colorCorrections: []
    },
    {
    id: "red-full",
    name: "Red+ (LUT + Color Correction + Chroma Key)",
    lut: "LUTs/red-isolated.png",
    enableLUT: true,
    chromaKeys: [
        // Both target reds—add both so it works for both shades at once!
        {
            ckey_color: [187/255, 115/255, 91/255],  // #bb735b
            ckey_similarity: 30.0 / 255.0,
            ckey_smoothness: 10.0,
            ckey_spill: 200.0
        },
        {
            ckey_color: [113/255, 75/255, 79/255],  // #714b4f
            ckey_similarity: 30.0 / 255.0,
            ckey_smoothness: 10.0,
            ckey_spill: 200.0
        }
    ],
    colorCorrections: [
        {
            gamma: 0.0,
            contrast: 0.13,      // increase or decrease as desired
            brightness: 0.0493,     // add more if you want it brighter
            saturation: 2.4     // boost reds for punch
        }
    ]
},

    {
        id: "blue-enhanced",
        name: "Blue+",
        lut: "LUTs/blue-isolated.png",
        enableLUT: true,
        chromaKeys: [
            {
                ckey_color: [41 / 255, 49 / 255, 36 / 255],
                ckey_similarity: 10.0 / 255.0,
                ckey_smoothness: 31.0,
                ckey_spill: 195.0
            }
        ],
        colorCorrections: [
            {
                gamma: -0.06,
                contrast: 0.23,
                saturation: 1.39
            }
        ]
    },
    {
        id: "red-enhanced",
        name: "Red+",
        lut: "LUTs/red-isolated.png",
        enableLUT: true,
        chromaKeys: [
            {
                ckey_color: [91 / 255, 0 / 115, 187 / 255],
                ckey_similarity: 1.0 / 255.0,
                ckey_smoothness: 1.0,
                ckey_spill: 347.0
            }
        ],
        colorCorrections: [
            {
                gamma: 0.03,
                contrast: 0.13,
                brightness: 0.0493,
                saturation: 3.3
            },
        ]
    },
    {
        id: "green-enhanced",
        name: "Green+",
        lut: "LUTs/green-isolated.png",
        enableLUT: true,
        chromaKeys: [
            {
                ckey_color: [38 / 255, 47 / 255, 40 / 255],
                ckey_similarity: 1.0 / 255.0,
                ckey_smoothness: 1.0,
                ckey_spill: 30.0
            }
        ],
        colorCorrections: [
            {
                gamma: -0.15,
                contrast: 0.25,
                saturation: 0.34
            }
        ]
    }
];
