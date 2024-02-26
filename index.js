const express = require('express');
const app = express();
const cors = require('cors');
const path = require('path');
const engine = require('ejs-locals')
const bodyParser = require('body-parser');
const morgan = require('morgan');
require('dotenv').config();
app.use(cors());
const mongoose = require('mongoose');
const async=require('async');
mongoose.set('debug', process.env.NODE_ENV === 'development');

app.use(express.json());
app.use(bodyParser.json());
app.use(morgan('dev'));
app.use(bodyParser.urlencoded({ extended: true }));


app.use(express.static(path.join(__dirname, 'static')))
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))
// app.use('/public', express.static(path.join(__dirname, 'public')))
app.set('views', path.join(__dirname, 'views'))
app.engine('ejs', engine)
app.set('view engine', 'ejs')

app.use((req, res, next) => {
  res.success = (data, message) => {
    // console.log(data)
    res.status(200).json({
      success: true,
      data,
      message,
    })
  }
  res.error = (data, message) => {
    // console.log(data)
    res.status(200).json({
      success: false,
      data,
      message,
    })
  }
  res.warn = (data, message) => {
    // console.log(data)
    res.status(200).json({
      success: false,
      data,
      message,
    })
  }
  next()
});

const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./docs/swagger.json');
app.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerDocument, {
    customfavIcon: '/fav32.png',
    customSiteTitle: 'Quiz',
    authorizeBtn: false,
    swaggerOptions: {
      filter: true,
      displayRequestDuration: true,
    },
  }),
);

const port = process.env.PORT
const connectDB = require('./db/db');
app.use('/api', require('./routes/apiRoutes'));
app.use('/admin', require('./routes/adminRoutes'));

const http = require('http');
server = http.createServer(app);
server.listen(port, () => console.log(`Server running on port ${port}`));
const io = require("socket.io")(server, {allowEIO3: true});
module.exports={io};

const ScheduleController = require('./controllers/scheduleController');
ScheduleController.Scheduler();



//-----------------------SOCKET IO------------------------------------------------




const { User ,Game ,UserGame ,UserQuestion,Question,Transaction, Wallet,Pool } = require('./db/models/User.model');
const Setting=require('./db/models/setting.model');

var gameArr=[]



io.on('connection', socket => {

  console.log(socket.id)

  io.to(socket.id).emit('message', 'socket is connected');

  socket.on('joinGame', async (data, callback) => {
      let {gameId,userId} = data;
    if (gameId && userId) {
      [gameId, userId] = [gameId.toString(), userId.toString()]
      if (!findById(gameId, userId,socket.id)) {
        socket.join(gameId);
        gameArr.push({gameId, userId,socketId:socket.id});
      }

      console.log(socket.id)
      io.to(socket.id).emit('message', 'Joined game successfully');
    }
      
  });

  socket.on('send_question', async (data, callback) => {
      try {
        console.log("_____________________________________________________________>>>")
        const settings=await Setting.findOne({});
        const { nextQuestionTiming,questionTiming}=settings;
        const tTime=(nextQuestionTiming+questionTiming)*1000;
        
        console.log("+++++++++++++++++++++++++++",typeof data,data)
         let {gameId} =data;
          let q_no=0;
        
          const game=await Game.aggregate([
            {
              $match:{
                _id: new mongoose.Types.ObjectId(gameId)
                // _id:gameId
              }
            },
            {
              $lookup: {
                from: 'questions',
                let: {
                  gameId: '$_id',
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ['$gameId', "$$gameId"] }
                        ],
                      },
                    },
                  }
                ],
                as: 'Questions',
              },
            },
            {
              $unwind:"$Questions"
            },
            {
              $project:{
                QuestionH:"$Questions.questionInHindi",
                QuestionE:"$Questions.questionInEnglish",
                optionH:"$Questions.optionsInHindi", 
                optionE:"$Questions.optionsInEnglish",
                q_no:"$Questions.q_no",
                answer:"$Questions.answer",
                noOfQuestion:1,
                duration:1,
                questionId:"$Questions._id",
              }
            }
          ]);

          let QuestionHindi=[];
          let QuestionEnglish=[];

          for (let i = 0; i < game.length; i++) {
            QuestionHindi.push({QuestionH:game[i].QuestionH,optionH:game[i].optionH,answer:game[i].answer,q_no:game[i].q_no,questionId:game[i].questionId});
            QuestionEnglish.push({QuestionE:game[i].QuestionE,optionH:game[i].optionE,answer:game[i].answer,q_no:game[i].q_no,questionId:game[i].questionId})
            
          }


          const { duration,noOfQuestion}=game[0];
          const ttTime=tTime*noOfQuestion;
         
          console.log(io.sockets.adapter.rooms)
       
           console.log({ QuestionEnglish,QuestionHindi, t:questionTiming, duration, noOfQuestion, interval: nextQuestionTiming })
            socket.to(gameId).emit('get-question', { QuestionEnglish,QuestionHindi, t:questionTiming, duration, noOfQuestion, interval: nextQuestionTiming,gameId });
         

        setTimeout(async function () {

          var userGame = await UserGame.aggregate([
            {
              $match: {
                gameId: new mongoose.Types.ObjectId(gameId)
              }
            }
          ]);

          const { pool } = await Pool.findOne({ gameId });
          if (userGame.length > 0) {

            userGame.sort(function (a, b) {

              if (b.mainPoints < a.mainPoints) {
                return -1;
              } else if (b.mainPoints > a.mainPoints) {
                return 1;
              } else {
                if (a.joinedAt < b.joinedAt) {
                  return -1;
                } else if (a.joinedAt > b.joinedAt) {
                  return 1;
                } else {
                  return 0;
                }
              }
            });

            userGame.forEach(function (user, index) {
              user.rank = index + 1;
            });

            const transactions = [];
            for (let i = 0; i < userGame.length; i++) {
              const user = userGame[i];
              await UserQuestion.findByIdAndUpdate({_id:user._id},{$set:{rank:user.rank}});
              const reward = pool.find(poolItem => user.rank >= poolItem.from && user.rank <= poolItem.to);
              user.wonAmount = reward?.amount ? reward?.amount : 0;
              if (reward) {
                transactions.push({ userId: user.userId, gameId: user.gameId, amount: reward.amount, msg: 'Game Won', type: 2, status: 1 });

              }
            }

            await Transaction.insertMany(transactions);

            async.mapSeries(transactions, async function (t) {
              await Wallet.findOneAndUpdate({ userId: t.userId }, { $set: { $inc: { balance: t.amount, winBalance: t.amount } } });
            })

            await Game.findOneAndUpdate({ gameId: new mongoose.Types.ObjectId(gameId) }, { $set: { isCompleted: true,status:2 } });

          }

        }, ttTime + 120000);



      } catch (err) {
          console.log(err);
      }
  });

  socket.on('wantQuestions', async (data, callback) => {
    try {

      console.log("+++++++++++++++++++++++++++",typeof data,data)
       let {gameId} =data;
        let q_no=0;
      
        const game=await Game.aggregate([
          {
            $match:{
              _id: new mongoose.Types.ObjectId(gameId)
              // _id:gameId
            }
          },
          {
            $lookup: {
              from: 'questions',
              let: {
                gameId: '$_id',
              },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ['$gameId', "$$gameId"] }
                      ],
                    },
                  },
                }
              ],
              as: 'Questions',
            },
          }
        ]);



        const { duration,noOfQuestion,Questions}=game[0];
        const t=(duration/noOfQuestion);
        
        io.to(socket.id).emit('get-question', { Questions,t,duration,noOfQuestion,interval:5000 });
        
    } catch (err) {
        console.log(err);
    }
});

  socket.on('get_result', async (data, callback) => {
      try {

          let questionId = data.questionId;
          if(questionId){
            const question=await Question.aggregate([
              {
                $match: {
                  _id:new mongoose.Types.ObjectId(questionId)
                }
              },
              {
                $lookup: {
                  from: 'userquestions',
                  let: {
                    questionId: '$_id',
                  },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $and: [
                            { $eq: ['$questionId', "$$questionId"] }
                          ],
                        },
                      },
                    },
                    {
                      $sort:{
                        rank:1
                      }
                    }
                  ],
  
                  as: 'UserQuestion',
                },
              }
            ])
  
            io.to(socket.id).emit('get_result_on', {data: question});

          }else{
            io.to(socket.id).emit('get_result_on', {data: {}});
          }

         
          
          // return callback({ data: question });

      } catch (err) {
          console.log(err);
      }
  });

  socket.on('give_answer', async (data, callback) => {
    try {

        const { questionId,gameId,question,timeTaken,answer,rawPoints,rM,rC,type,userId}=data;
        console.log(questionId,gameId,question,timeTaken,answer,rawPoints,rM,rC,type,userId,"=============>>>>>GIVE_ANSWER")

        const _question=await Question.findOne({_id:new mongoose.Types.ObjectId(questionId)});
        if(_question){

          const settings=await Setting.findOne({});
          const { rightQuestionMarks, wrongQuestionMarks}=settings;
          const mM=_question.answer==answer?rightQuestionMarks:wrongQuestionMarks;
          const mainPoints=calculate(calculate(mM, rC),timeTaken);
  
          const userQuestion=new UserQuestion({
            gameId,
            question,
            userId,
            questionId,
            timeTaken,
            answer,
            mainPoints,
            rawPoints,
            isCorrect:_question.answer==answer?true:false,
            rM,
            rC,
            mM,
            mC:rC,
            type
          });
  
          await userQuestion.save();
          _question.questAttempted+=1;
          await UserGame.findOneAndUpdate({userId,gameId},{$set:{$inc:{mainPoints,rawPoints }}})
          await _question.save();

          io.to(socket.id).emit('give_answer_on', {data: userQuestion});
        //  return callback({ data: userQuestion });

        }else{
          io.to(socket.id).emit('give_answer_on', {});
        }
      

    } catch (err) {
        console.log(err);
    }
});

});

function findById(gameId,userId,socketId) {
  console.log(typeof gameId,typeof userId,typeof socketId,gameId,userId,socketId)
  const flag=gameArr.find(obj => (obj.gameId === gameId)&&(obj.userId === userId)&&(obj.socketId==socketId));
  console.log("FLAG------>",gameArr.find(obj => (obj.gameId === gameId)&&(obj.userId === userId)&&(obj.socketId==socketId)))
  return flag;
}




function calculate(num1, num2) {
  const result = num1 + num2;
  
  if (result > 9.5) {
    
    const [integerPart, decimalPart] = result.toString().split('.');
    const integerSum = integerPart.split('').map(Number).reduce((acc, digit) => acc + digit, 0);
    const decimalSum = decimalPart ? decimalPart.split('').map(Number).reduce((acc, digit) => acc + digit, 0) / 10 : 0;

    const sum = integerSum + decimalSum;
    if (sum > 9.5) {
      return calculate(sum, 0);
    }

    if (sum === 9.5) {
      return sum;
    }
    return sum;
  }
 return result;
}