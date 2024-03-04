import axios from "axios";

class DescriptionParser {

    constructor(descriptionUrl) {
        this.url = descriptionUrl;
    }

    async Parsing() {

        await axios.get(this.url)
        .then(async (response) => {
            this.flowBoundary[0] = response.data["flow_boundary"]["u_min"];
            this.flowBoundary[1] = response.data["flow_boundary"]["v_min"];
            this.flowBoundary[2] = response.data["flow_boundary"]["u_max"];
            this.flowBoundary[3] = response.data["flow_boundary"]["v_max"];

            this.maxTextureSize = response.data["constraints"]["max_texture_size"],
            this.maxTrajectoryNum = response.data["constraints"]["max_streamline_num"],
            this.maxSegmentNum = response.data["constraints"]["max_segment_num"],
            this.maxDropRate = response.data["constraints"]["max_drop_rate"],
            this.maxDropRateBump = response.data["constraints"]["max_drop_rate_bump"]

            this.extent[0] = response.data["extent"][0];
            this.extent[1] = response.data["extent"][1];
            this.extent[2] = response.data["extent"][2];
            this.extent[3] = response.data["extent"][3];

            for (const url of response.data["flow_fields"]) {
                this.flowFieldResourceArray.push(url);
            }
            this.flowFieldTextureSize[0] = response.data["texture_size"]["flow_field"][0];
            this.flowFieldTextureSize[1] = response.data["texture_size"]["flow_field"][1];

            for (const url of response.data["area_masks"]) {
                this.seedingResourceArray.push(url);
            }
            this.seedingTextureSize[0] = response.data["texture_size"]["area_mask"][0];
            this.seedingTextureSize[1] = response.data["texture_size"]["area_mask"][1];

            this.transform2DHighResource = response.data["projection"]["2D"]["high"];
            this.transform2DLowResource = response.data["projection"]["2D"]["low"];
            this.transform3DResource = response.data["projection"]["3D"];
            this.transformTextureSize[0] = response.data["texture_size"]["projection"][0];
            this.transformTextureSize[1] = response.data["texture_size"]["projection"][1];

        })
        .catch((error) => {
            console.log("ERROR::RESOURCE_NOT_LOAD_BY_URL", error.toJSON());
        });
    }

}

class ProjectParser {

    constructor(configUrl) {
        this.url = configUrl;
        this.projects = [];
        this.projectsHaveSamePhaseCount = true;
    }

    async parsing() {

        await axios.get(this.url)
        .then(async (response) => {

            for (const project of response.data["projects"]) {

                let name = project["name"];
                
                let flowBoundary = [];
                flowBoundary[0] = project["flow_boundary"]["u_min"];
                flowBoundary[1] = project["flow_boundary"]["v_min"];
                flowBoundary[2] = project["flow_boundary"]["u_max"];
                flowBoundary[3] = project["flow_boundary"]["v_max"];
    
                let maxTextureSize = project["constraints"]["max_texture_size"];
                let maxTrajectoryNum = project["constraints"]["max_streamline_num"];
                let maxDropRate = project["constraints"]["max_drop_rate"];
                let maxSegmentNum = project["constraints"]["max_segment_num"];
                let maxDropRateBump = project["constraints"]["max_drop_rate_bump"];
    
                let extent = [];
                extent[0] = project["extent"][0];
                extent[1] = project["extent"][1];
                extent[2] = project["extent"][2];
                extent[3] = project["extent"][3];
    
                let flowFieldResourceArray = [];
                for (const url of project["flow_fields"]) {
                    flowFieldResourceArray.push(url);
                }

                let flowFieldTextureSize = []; 
                flowFieldTextureSize[0] = project["texture_size"]["flow_field"][0];
                flowFieldTextureSize[1] = project["texture_size"]["flow_field"][1];
    
                let seedingResourceArray = [];
                for (const url of project["area_masks"]) {
                    seedingResourceArray.push(url);
                }

                let seedingTextureSize = []
                seedingTextureSize[0] = project["texture_size"]["area_mask"][0];
                seedingTextureSize[1] = project["texture_size"]["area_mask"][1];
    
                let highTransformResource = project["projection"]["high"];
                let lowTransformResource = project["projection"]["low"];

                let transformTextureSize = [];
                transformTextureSize[0] = project["texture_size"]["projection"][0];
                transformTextureSize[1] = project["texture_size"]["projection"][1];

                this.projects.push({
                    name: name,
                    flowFieldResourceArray: flowFieldResourceArray,
                    seedingResourceArray: seedingResourceArray,
                    highTransformResource: highTransformResource,
                    lowTransformResource: lowTransformResource,
                    maxDropRate: maxDropRate,
                    maxDropRateBump: maxDropRateBump,
                    maxSegmentNum: maxSegmentNum,
                    maxTrajectoryNum: maxTrajectoryNum,
                    maxTextureSize: maxTextureSize,
                    extent: extent,
                    flowBoundary: flowBoundary,
                    flowFieldTextureSize: flowFieldTextureSize,
                    seedingTextureSize: seedingTextureSize,
                    transformTextureSize: transformTextureSize,
                });
            }
        })
        .catch((error) => {
            console.log("ERROR::RESOURCE_NOT_LOAD_BY_URL", error.toJSON());
        });

        return this.projects;
    }
}

export {
    ProjectParser,
    DescriptionParser,
}