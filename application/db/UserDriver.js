"use strict";

const _ = require("lodash");
const AbstractDriver = require("./AbstractDriver");
const UserModel = require("@models").User;
const log = require("@utils").logger(module);
const mongoose = require("mongoose")
const ObjectId = mongoose.Types.ObjectId;

class UserDriver extends AbstractDriver {
    constructor() {
        super(UserModel)
    }

    async getByCredentials(username, password) {
        const user = await this.findOne({
            username
        });
        if (user && await user.comparePassword(password)) {
            return user;
        }
        return null;
    }

    async getByToken(kind, token) {
        const user = await this.findById(token.id);
        if (!user) return null;
        if (user.jwtSecrets[kind] === token.salt) {
            return user;
        } else {
            return null;
        }
    }

    create({username, password, isAdmin}) {
        if (isAdmin) {
            return super.create({
                username,
                password,
                isAdmin: true,
                boss:null
            });
        } else {
            return super.create({
                username,
                password,
                role: "user",
                boss: ObjectId(this.ROOT_ADMIN.id)
            });
        }

    }

    async createRootAdmin({username, password}) {
        // check, is root user exist
        return super.findOne({
            role: "root"
        })
            .then(rootAdmin => {
                // if exist
                if (rootAdmin) {
                    // update  password
                    rootAdmin.password = password;
                    //return super user
                    return rootAdmin.save();
                } else {
                    // esle create new user with specified fields
                    return super.create({
                        username,
                        password,
                        role: "root"
                    });
                }
            })
            .then(rootAdmin => {
                return {
                    rootAdmin,
                    username: rootAdmin.username,
                    password
                };
            })
    }

    set ROOT_ADMIN(value) {
        const {
            password,
            username,
            id
        } = value;
        this._rootAdmin = {
            password,
            username,
            id
        };
    }

    get ROOT_ADMIN() {
        return this._rootAdmin;
    }

    /**
     * PROCESS RELATIONS WITH OLD BOSS
     */
    async removeWorkerFromOldBoss(worker) {
        let oldBoss = null;
        if (worker.boss && worker.boss.str !== this.ROOT_ADMIN.id.str) {
            oldBoss = await super.findById(worker.boss);
        }
        // decrease old boss's count of workers
        if (oldBoss) {
            oldBoss.countOfWorkers--;
            await oldBoss.save();
        }
    }

    /**
     * PROCESS RELATIONS WITH NEW BOSS
     */
    async addWorkerToBoss(worker, boss) {
        if (boss && boss.id !== this.ROOT_ADMIN.id) {
            if (worker.id === boss.id) {
                throw new Error("Try to build ciclic connections");
            }
            worker.boss = boss.id;
            boss.countOfWorkers++;
            return Promise.all([worker.save(), boss.save()]);
        } else {
            worker.boss = this.ROOT_ADMIN.id;
            return worker.save();
        }
    }

    async addWorker(boss, worker) {
        await this.removeWorkerFromOldBoss(worker);
        await this.addWorkerToBoss(worker, boss);
    }

    async isBossOf(boss, worker) {
        // user is not boss of himself
        if(boss._id===worker._id){
            return false;
        }
        // boss is admin, so he is boss for everyone
        if(!boss.boss){
            return true;
        }
        // else search boss of boss
        const bossOfBoss=await this.findById(boss.boss);
        return this._model.aggregate()
            .match({_id: worker._id})
            .graphLookup({
                from: "users",
                startWith: "$boss",
                connectFromField: "boss",
                connectToField: "_id",
                as: 'connections',
                restrictSearchWithMatch: {
                    "_id": {"$ne": bossOfBoss._id}
                },
            })
            .project({
                _id: 1,
                steps: 1,
                connections: "$connections._id"
            })
            .exec()
            .then((result) => {
                return _.findIndex(result[0].connections, boss._id) >= 0;
            })
    }
}


module.exports = new UserDriver();